import type { MiddlewareFn } from "../types.js";

const logger: MiddlewareFn = async (msg, ctx) => {
  ctx.log.info(
    {
      platform: msg.platform,
      event: msg.event,
      from: msg.from,
      group: msg.groupId,
      text: msg.text?.slice(0, 80),
    },
    "msg",
  );
};

export default logger;
