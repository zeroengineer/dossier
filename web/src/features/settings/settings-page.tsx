import type * as React from "react"
import { PageHeader } from "@/components/page-header"
import { SettingsNav } from "./settings-nav"

interface SettingsPageProps {
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}

/** Frame of every settings page: the page header, the settings sub-navigation, then the page body. */
export function SettingsPage({ title, description, meta, actions, children }: SettingsPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader title={title} description={description} meta={meta} actions={actions} />
        <SettingsNav />
      </div>
      {children}
    </div>
  )
}
