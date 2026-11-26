import { masterAgentService } from "@chatbotx.io/business"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnFindingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  masterAgentSessionIdParam,
  masterAgentSessionResource,
  sendMasterAgentMessageRequest,
} from "../schema/public"

// A Master Agent turn only drafts broadcasts, so the broadcasts scope is the
// resource it acts on (invariant: a token's scope is the resource, not the
// nearest convenient one). `read_only` tokens can still read a session.
const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("broadcasts")

const TIMEZONE_NOTE =
  "Times are read as Asia/Saigon. The agent only ever drafts: nothing is scheduled or sent until a member confirms the draft."

export const masterAgentPublicRouter = {
  sendMessage: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/master-agent/messages",
      summary: "Send message to Master Agent",
      description: `Runs one Master Agent turn: the agent reads the message (typically a Zoom summary), looks up the group contact, and drafts a reminder broadcast for it. Returns the whole session with the assistant turn \`pending\` — call \`masterAgent.getSession\` with the returned \`sessionId\` until its \`status\` is \`completed\` or \`failed\`, and read \`drafts\` for the reminder the turn created. ${TIMEZONE_NOTE} Confirm a draft with \`broadcasts.schedule\`.`,
      tags: ["Master Agent"],
      // Drafting a reminder sends nothing: the turn only writes a chat row and
      // a `draft` broadcast, so no outbound confirmation is warranted here.
      spec: mcpSpec({ visibility: "default", hitlPolicy: "none" }),
    })
    .input(sendMasterAgentMessageRequest)
    .output(masterAgentSessionResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      return await masterAgentService.sendMessage({
        workspaceId: context.workspace.id,
        // A workspace token is not a member; the session records no author.
        memberId: null,
        message: input.message,
        sessionId: input.sessionId ?? null,
      })
    }),

  getSession: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/master-agent/sessions/{sessionId}",
      summary: "Get Master Agent session",
      description: `Returns a session's messages and the reminder drafts linked to it, scoped to the calling workspace (another workspace's session id is a 404). Use it to poll \`masterAgent.sendMessage\` while \`status\` is \`pending\`. ${TIMEZONE_NOTE}`,
      tags: ["Master Agent"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(masterAgentSessionIdParam)
    .output(masterAgentSessionResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await masterAgentService.getSession({
          workspaceId: context.workspace.id,
          sessionId: input.sessionId,
        }),
    ),
}
