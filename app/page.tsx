import { RecoverLoopDashboard } from "./recoverloop-dashboard";
import { createSeedState } from "@/lib/seed";

export default function Home() {
  return <RecoverLoopDashboard initialState={createSeedState()} />;
}
