import { invalidateCacheByTags } from "@inboxos.io/redis"

export class BaseService {
  protected invalidateCacheTags(tags: string | string[]) {
    return invalidateCacheByTags(Array.isArray(tags) ? tags : [tags])
  }
}
