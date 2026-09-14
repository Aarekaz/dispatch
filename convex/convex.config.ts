import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(agent);
app.use(betterAuth);

export default app;
