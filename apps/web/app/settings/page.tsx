import { SettingsWorkspace } from "@/components/features/settings/settings-workspace"
import { getSettings } from "@/lib/api/settings/settings"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  let initialSnapshot = null
  try {
    const res = await getSettings()
    initialSnapshot = res.data ?? null
  } catch {
    // Allow page to load cleanly even if BE API is temporarily offline during startup/build
  }

  return <SettingsWorkspace variant="page" initialSnapshot={initialSnapshot} />
}
