CREATE TYPE "masterAgentMessageRole" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "masterAgentMessageStatus" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "MasterAgentMessage" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"sessionId" text NOT NULL,
	"role" "masterAgentMessageRole" NOT NULL,
	"content" text NOT NULL,
	"status" "masterAgentMessageStatus" DEFAULT 'completed'::"masterAgentMessageStatus" NOT NULL,
	"broadcastId" bigint,
	"createdById" bigint
);
--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_workspaceId_idx" ON "MasterAgentMessage" ("workspaceId");--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_workspaceId_sessionId_createdAt_id_idx" ON "MasterAgentMessage" ("workspaceId","sessionId","createdAt" ASC,"id" ASC);--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_broadcastId_idx" ON "MasterAgentMessage" ("broadcastId") WHERE "broadcastId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MasterAgentMessage_createdById_idx" ON "MasterAgentMessage" ("createdById") WHERE "createdById" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "MasterAgentMessage" ADD CONSTRAINT "MasterAgentMessage_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentMessage" ADD CONSTRAINT "MasterAgentMessage_broadcastId_Broadcast_id_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "MasterAgentMessage" ADD CONSTRAINT "MasterAgentMessage_createdById_User_id_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;