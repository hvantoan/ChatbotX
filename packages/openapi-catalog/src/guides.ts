import {
  guide_contacts_and_pipelines,
  guide_flows_and_automation,
  guide_inbox_and_handover,
  guide_overview,
} from "./guides-content"

const guideDefinitions = {
  overview: {
    content: guide_overview,
    description: "MCP discovery, approvals, and OAuth checkpoints.",
  },
  "flows-and-automation": {
    content: guide_flows_and_automation,
    description:
      "FlowSpec, publishing, broadcasts, and bulk automation safety.",
  },
  "inbox-and-handover": {
    content: guide_inbox_and_handover,
    description:
      "Conversation replies, handover, bot control, and connection checkpoints.",
  },
  "contacts-and-pipelines": {
    content: guide_contacts_and_pipelines,
    description:
      "Contact resolution, bulk changes, and pipeline mutation safety.",
  },
} as const

export type GuideName = keyof typeof guideDefinitions

export type Guide = {
  content: string
  description: string
  name: GuideName
  uri: `inboxos://guides/${GuideName}`
}

export const guideNames = Object.keys(guideDefinitions) as GuideName[]

export const isGuideName = (name: string): name is GuideName =>
  Object.hasOwn(guideDefinitions, name)

/**
 * The guides are embedded string constants, so this is a lookup, never a
 * filesystem read — a bundled consumer (tsdown) ships them without copying
 * markdown into its dist.
 */
export const getGuide = (name: GuideName): Guide => {
  const definition = guideDefinitions[name as keyof typeof guideDefinitions]
  return {
    content: definition.content,
    description: definition.description,
    name,
    uri: `inboxos://guides/${name}`,
  }
}
