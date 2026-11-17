import { IntegrationException, SdkException } from "@chatbotx.io/sdk"

export class ZaloPersonalAPIException extends IntegrationException {
  override readonly httpStatusCode: number

  constructor(message: string, httpStatusCode = 500) {
    super(message, "zaloPersonalAPIException")
    this.httpStatusCode = httpStatusCode
  }
}

export class ZaloPersonalWebhookException extends SdkException {
  constructor(message: string) {
    super(message, "zaloPersonalWebhookException")
  }
}

export class ZaloPersonalException extends SdkException {
  constructor(message: string) {
    super(message, "zaloPersonalException")
  }
}
