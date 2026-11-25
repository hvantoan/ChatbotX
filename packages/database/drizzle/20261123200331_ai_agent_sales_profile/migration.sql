CREATE TYPE "aiAgentSalesProfileVersionSource" AS ENUM('manual', 'proposal', 'revert');--> statement-breakpoint
CREATE TYPE "aiAgentTrainingMessageRole" AS ENUM('admin', 'assistant');--> statement-breakpoint
CREATE TABLE "AIAgentSalesProfileVersion" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"aiAgentId" bigint NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"source" "aiAgentSalesProfileVersionSource" NOT NULL,
	"instruction" text,
	"createdById" bigint
);
--> statement-breakpoint
CREATE TABLE "AIAgentTrainingMessage" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"aiAgentId" bigint NOT NULL,
	"role" "aiAgentTrainingMessageRole" NOT NULL,
	"content" text NOT NULL,
	"proposal" jsonb,
	"appliedVersion" integer,
	"createdById" bigint
);
--> statement-breakpoint
ALTER TABLE "AIAgent" ADD COLUMN "salesProfile" jsonb;--> statement-breakpoint
ALTER TABLE "AIAgent" ADD COLUMN "salesProfileVersion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "AIAgentSalesProfileVersion_aiAgentId_version_key" ON "AIAgentSalesProfileVersion" ("aiAgentId","version");--> statement-breakpoint
CREATE INDEX "AIAgentSalesProfileVersion_workspaceId_idx" ON "AIAgentSalesProfileVersion" ("workspaceId");--> statement-breakpoint
CREATE INDEX "AIAgentSalesProfileVersion_aiAgentId_idx" ON "AIAgentSalesProfileVersion" ("aiAgentId");--> statement-breakpoint
CREATE INDEX "AIAgentSalesProfileVersion_createdById_idx" ON "AIAgentSalesProfileVersion" ("createdById") WHERE "createdById" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "AIAgentTrainingMessage_workspaceId_idx" ON "AIAgentTrainingMessage" ("workspaceId");--> statement-breakpoint
CREATE INDEX "AIAgentTrainingMessage_aiAgentId_createdAt_id_idx" ON "AIAgentTrainingMessage" ("aiAgentId","createdAt" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "AIAgentTrainingMessage_createdById_idx" ON "AIAgentTrainingMessage" ("createdById") WHERE "createdById" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "AIAgentSalesProfileVersion" ADD CONSTRAINT "AIAgentSalesProfileVersion_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "AIAgentSalesProfileVersion" ADD CONSTRAINT "AIAgentSalesProfileVersion_aiAgentId_AIAgent_id_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "AIAgentSalesProfileVersion" ADD CONSTRAINT "AIAgentSalesProfileVersion_createdById_User_id_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "AIAgentTrainingMessage" ADD CONSTRAINT "AIAgentTrainingMessage_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "AIAgentTrainingMessage" ADD CONSTRAINT "AIAgentTrainingMessage_aiAgentId_AIAgent_id_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AIAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "AIAgentTrainingMessage" ADD CONSTRAINT "AIAgentTrainingMessage_createdById_User_id_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;