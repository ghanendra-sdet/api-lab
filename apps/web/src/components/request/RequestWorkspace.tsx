import { useActiveTab } from "../../store/useAppStore";
import { RequestTabs } from "./RequestTabs";
import { RequestBar } from "./RequestBar";
import { RequestConfigTabs } from "./RequestConfigTabs";
import { ParamsPanel } from "./ParamsPanel";
import { AuthPanel } from "./AuthPanel";
import { HeadersPanel } from "./HeadersPanel";
import { BodyPanel } from "./BodyPanel";
import { ScriptsPanel } from "./ScriptsPanel";
import { TestsPanel } from "./TestsPanel";
import { ResponsePanel } from "../response/ResponsePanel";
import { ContractPanel } from "../contract/ContractPanel";

export function RequestWorkspace() {
  const tab = useActiveTab();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <RequestTabs />
      <RequestBar tab={tab} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RequestConfigTabs tab={tab} />
        <div className="min-h-[180px]">
          {tab.activePanel === "params" && <ParamsPanel tab={tab} />}
          {tab.activePanel === "auth" && <AuthPanel tab={tab} />}
          {tab.activePanel === "headers" && <HeadersPanel tab={tab} />}
          {tab.activePanel === "body" && <BodyPanel tab={tab} />}
          {tab.activePanel === "scripts" && <ScriptsPanel tab={tab} />}
          {tab.activePanel === "tests" && <TestsPanel tab={tab} />}
          {tab.activePanel === "contract" && <ContractPanel tab={tab} />}
        </div>
        <ResponsePanel />
      </div>
    </div>
  );
}
