CREATE TYPE "masterAgentMessageRole" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "masterAgentMessageStatus" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "masterAgentHitlPolicy" AS ENUM('confirm_diff', 'confirm_outbound', 'confirm_destructive');--> statement-breakpoint
CREATE TYPE "masterAgentPendingActionStatus" AS ENUM('pending', 'approved', 'rejected', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "MasterAgentConfig" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"models" jsonb[] NOT NULL,
	"prompt" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"autoApproveDiff" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MasterAgentMessage" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"sessionId" text NOT NULL,
	"role" "masterAgentMessageRole" NOT NULL,
	"content" text NOT NULL,
	"status" "masterAgentMessageStatus" DEFAULT 'completed'::"masterAgentMessageStatus" NOT NULL,
	"createdById" bigint
);
--> statement-breakpoint
CREATE TABLE "MasterAgentPendingAction" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"sessionId" text NOT NULL,
	"messageId" bigint,
	"operationId" text NOT NULL,
	"args" jsonb NOT NULL,
	"execution" jsonb NOT NULL,
	"policy" "masterAgentHitlPolicy" NOT NULL,
	"currentState" jsonb,
	"status" "masterAgentPendingActionStatus" DEFAULT 'pending'::"masterAgentPendingActionStatus" NOT NULL,
	"result" jsonb,
	"decidedById" bigint,
	"decidedAt" timestamp(6) with time zone,
	"expiresAt" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "MasterAgentConfig_workspaceId_key" ON "MasterAgentConfig" ("workspaceId");--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_workspaceId_idx" ON "MasterAgentMessage" ("workspaceId");--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_workspaceId_sessionId_createdAt_id_idx" ON "MasterAgentMessage" ("workspaceId","sessionId","createdAt" ASC,"id" ASC);--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_createdById_idx" ON "MasterAgentMessage" ("createdById") WHERE "createdById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MasterAgentPendingAction_workspaceId_idx" ON "MasterAgentPendingAction" ("workspaceId");--> statement-breakpoint
CREATE INDEX "MasterAgentPendingAction_workspaceId_sessionId_idx" ON "MasterAgentPendingAction" ("workspaceId","sessionId");--> statement-breakpoint
CREATE INDEX "MasterAgentPendingAction_messageId_idx" ON "MasterAgentPendingAction" ("messageId") WHERE "messageId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MasterAgentPendingAction_decidedById_idx" ON "MasterAgentPendingAction" ("decidedById") WHERE "decidedById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MasterAgentPendingAction_workspaceId_status_idx" ON "MasterAgentPendingAction" ("workspaceId","status") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "MasterAgentConfig" ADD CONSTRAINT "MasterAgentConfig_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentMessage" ADD CONSTRAINT "MasterAgentMessage_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentMessage" ADD CONSTRAINT "MasterAgentMessage_createdById_User_id_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentPendingAction" ADD CONSTRAINT "MasterAgentPendingAction_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentPendingAction" ADD CONSTRAINT "MasterAgentPendingAction_decidedById_User_id_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;