import { probe } from "./probe.mjs";

export default {
  async scheduled() {
    try {
      console.log(JSON.stringify({ event: "exchange_liveness", ...(await probe()) }));
    } catch (error) {
      console.error(JSON.stringify({ event: "exchange_liveness_failed", message: String(error) }));
      throw error;
    }
  },
};
