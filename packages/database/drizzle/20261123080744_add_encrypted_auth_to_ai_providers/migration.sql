ALTER TABLE "IntegrationClaude" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationDeepseek" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationGemini" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationMuse" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationOpenai" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationOpenaiCompatible" ADD COLUMN "encryptedAuth" jsonb;--> statement-breakpoint
ALTER TABLE "IntegrationOpenrouter" ADD COLUMN "encryptedAuth" jsonb;