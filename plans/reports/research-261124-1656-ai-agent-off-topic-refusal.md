# AI Agent trả lời ngoài phạm vi (yêu cầu docker): cơ chế bảo vệ và từ chối hiện tại

Thời điểm: 2026-11-24 16:56 (Asia/Saigon). Nhánh: `feat/cb-5-ai-agent-sales-persona`. Nguồn: đọc code, chưa chạy lại hội thoại.

## Kết luận

Đúng là có vấn đề. Hiện **không có cơ chế giới hạn phạm vi (scope) chung** cho AI Agent. Lớp chống lạc đề duy nhất là Sales Guard, và nó chỉ chạy khi agent bật `salesProfile.enabled`. Ngay cả khi bật, Sales Guard được thiết kế để **lái khách quay về chủ đề chứ không từ chối**, nên câu trả lời kèm lệnh `docker ps` vẫn lọt qua.

## Các lớp bảo vệ hiện có

| Lớp | Vị trí | Áp dụng khi | Chặn được gì |
|---|---|---|---|
| Prompt của agent (người dùng tự viết) | `aiAgent.prompt`, `replies.ts:835` | Luôn luôn | Chỉ chặn những gì người dùng tự viết vào prompt |
| `toolOutputGuard` | `packages/ai/src/constants/index.ts:14` | Luôn luôn | Gửi JSON thô hoặc output của tool cho khách |
| `fabricationGuard` | `constants/index.ts:20` | Agent có tool | Bịa dữ liệu sản phẩm, giá, URL ảnh |
| `knowledgeBaseGuard` | `constants/index.ts:26` | Agent có tool KB | Trả lời về sản phẩm mà không tra KB |
| Chính sách untrusted input | `replies.ts:204` | **Chỉ** luồng generate-only (trả lời comment) | Prompt injection |
| Sales prompt, mục 3 | `packages/business/src/ai-agent/sales-prompt.ts:153` | `salesProfile.enabled` | Ngoài lề thì "trả lời ngắn tối đa 1 câu rồi dẫn dắt quay lại" |
| Sales Guard (Tier 1 kiểm tra giá, Tier 2 judge, rewrite, fallback, handoff) | `apps/worker/.../automated-response/sales-guard.ts:591` | `salesProfile.enabled` | Giá sai, lộ bot, lệch vai, lạc đề **không kèm dẫn dắt** |

Không lớp nào trả về câu từ chối kiểu "Em chỉ hỗ trợ về X".

## Vì sao câu trả lời docker lọt qua

1. **Agent không bật Sales Profile** (khả năng cao nhất). Prompt chỉ gồm prompt người dùng tự viết cộng các guard về tool. Không có gì nói "chỉ trả lời về sản phẩm", nên LLM làm đúng bản năng trợ lý chung là đưa ra lệnh `docker ps`. Câu "Em không chạy hộ được docker trên máy anh" là LLM tự từ chối phần *thực thi*, không phải hệ thống từ chối.
2. **Nếu Sales Profile có bật, nó vẫn có thể lọt**, vì mấy lý do sau:
   - Prompt cho phép trả lời câu ngoài lề trong một câu (`sales-prompt.ts:153`). Một khối lệnh bash cộng một câu vẫn "hợp lệ" theo cách hiểu của LLM.
   - Judge chỉ đặt `onTopic=false` khi câu ngoài lề **VÀ** trợ lý không lái về (`sales-guard.ts:422`). Câu trả lời mẫu không lái về nên lẽ ra bị bắt. Nhưng nếu model thêm một câu như "…anh cần tư vấn gì thêm không ạ" thì sẽ pass.
   - Judge **fail-open**: nếu timeout quá 4 giây hoặc gặp lỗi thì coi như `onTopic=true` (`sales-guard.ts:635,676`).
   - Kể cả khi bị bắt, kết quả là rewrite hoặc fallback chào hàng. Chỉ sau `offTopicLimit` lượt lạc đề liên tiếp mới **chuyển cho người** (`sales-guard.ts:787`). Cũng không có bước từ chối.
   - `forbiddenTopics` là danh sách đen do người dùng tự nhập. Không ai nghĩ đến chuyện liệt kê "docker/lập trình" vào đó.

## Dòng "→ skipped: API qua socket, add khi cần gọi từ PHP thật."

Dòng này trông như ghi chú của dev hoặc agent lập trình, không phải giọng tư vấn viên. Nếu nó **do bot gửi cho khách** thì đây là lỗi thứ hai: nội dung nội bộ bị rò ra. Nguồn khả dĩ là một tài liệu trong Knowledge Base, hoặc một ghi chú nằm trong prompt của agent, rồi được LLM chép lại. Cần kiểm tra lịch sử hội thoại và KB của workspace đó (xem câu hỏi mở).

## Đề xuất (theo thứ tự hiệu quả trên công sức)

1. **Thêm scope policy do code sở hữu, áp cho mọi agent** (không phụ thuộc Sales Profile). Thêm `helpTexts.scopeGuard` vào `appendToolOutputGuard` hoặc một hàm `appendScopeGuard` mới, với nội dung đại ý:
   - Chỉ hỗ trợ trong phạm vi doanh nghiệp/sản phẩm mô tả ở trên.
   - Không viết code, lệnh shell, script; không làm bài tập; không tư vấn y tế, pháp lý hay tài chính ngoài phạm vi.
   - Khi khách yêu cầu ngoài phạm vi: từ chối lịch sự trong một câu, không đưa nội dung được yêu cầu, rồi gợi ý quay lại chủ đề chính.

   Đây là cách rẻ nhất và chặn được phần lớn trường hợp.
2. **Thêm cấu hình phạm vi dạng danh sách trắng**, ví dụ `allowedScope` hoặc một toggle `strictScope` trên agent, kèm câu từ chối tuỳ chỉnh (`offTopicReply`). Danh sách đen `forbiddenTopics` không bao giờ đủ. Theo invariant 23, cấu hình này phải đi kèm public API, CLI và MCP.
3. **Siết Sales Guard** khi profile đang bật:
   - Đổi định nghĩa `onTopic` thành "trả lời có cung cấp nội dung ngoài phạm vi hay không" thay vì "có lái về hay không".
   - Thêm kiểm tra tất định (Tier 1) chặn code block hoặc lệnh shell (```` ``` ````, `docker`, `sudo`, `curl`, …) trong câu trả lời, phòng khi judge fail-open.
   - Khi vi phạm ngoài phạm vi thì gửi câu từ chối cố định thay vì rewrite.
4. **Bổ sung kịch bản eval**: thêm case "yêu cầu viết code hoặc lệnh" vào `apps/worker/__tests__/fixtures/sales-scenarios.json`, và một test cho agent không có Sales Profile.

Bước tiếp theo nên làm: (1) và (4) trước, sau đó quyết định (2) vì nó thay đổi public contract.

## Câu hỏi mở

- Agent trong hội thoại này có bật `salesProfile.enabled` không? Kết luận nguyên nhân chính phụ thuộc vào điều này.
- Dòng "→ skipped: …" là do bot gửi cho khách hay là ghi chú của anh? Nếu do bot gửi, cần ID hội thoại hoặc workspace để tìm nguồn trong KB hoặc prompt.
- Câu từ chối nên cố định hay cho mỗi agent tự cấu hình?
