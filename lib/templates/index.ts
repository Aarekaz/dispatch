import type { AgentPack } from "@/lib/types";

import { contentWriter } from "./content-writer";
import { customerSupport } from "./customer-support";
import { dataAnalyst } from "./data-analyst";
import { deepResearcher } from "./deep-researcher";
import { executiveAssistant } from "./executive-assistant";
import { feedbackMiner } from "./feedback-miner";
import { fieldMonitor } from "./field-monitor";
import { incidentCommander } from "./incident-commander";
import { projectManager } from "./project-manager";
import { salesDevRep } from "./sales-dev-rep";
import { socialMediaCreator } from "./social-media-creator";

export const agentPacks: AgentPack[] = [
  executiveAssistant,
  customerSupport,
  deepResearcher,
  projectManager,
  socialMediaCreator,
  contentWriter,
  salesDevRep,
  dataAnalyst,
  feedbackMiner,
  fieldMonitor,
  incidentCommander,
];
