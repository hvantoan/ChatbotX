import type { appointmentService } from "@inboxos.io/business"

export type AppointmentManagementListItem = Awaited<
  ReturnType<typeof appointmentService.list>
>["data"][number]
