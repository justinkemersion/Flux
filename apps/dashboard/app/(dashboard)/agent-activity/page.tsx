import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AgentActivityPanel } from "@/src/components/agent-activity/agent-activity-panel";

export const runtime = "nodejs";

function AgentActivityFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-24 text-zinc-500">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
    </div>
  );
}

export default function AgentActivityPage() {
  return (
    <Suspense fallback={<AgentActivityFallback />}>
      <AgentActivityPanel />
    </Suspense>
  );
}
