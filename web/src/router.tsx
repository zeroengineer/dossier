import { lazy } from "react"
import { Navigate, createBrowserRouter, type RouteObject } from "react-router"
import { AppShell } from "@/components/app-shell"
import type { RouteHandle } from "@/components/breadcrumbs"
import { RootError, RouteError } from "@/components/route-error"

const Dashboard = lazy(() => import("@/pages/dashboard"))
const Vault = lazy(() => import("@/pages/vault"))
const Documents = lazy(() => import("@/pages/documents"))
const Document = lazy(() => import("@/pages/document"))
const Entities = lazy(() => import("@/pages/entities"))
const Entity = lazy(() => import("@/pages/entity"))
const Generate = lazy(() => import("@/pages/generate"))
const Templates = lazy(() => import("@/pages/templates"))
const Upload = lazy(() => import("@/pages/upload"))
const Search = lazy(() => import("@/pages/search"))
const BrandsSettings = lazy(() => import("@/pages/settings-brands"))
const BrandSettings = lazy(() => import("@/pages/settings-brand"))
const NumberingSettings = lazy(() => import("@/pages/settings-numbering"))
const WorkspaceSettings = lazy(() => import("@/pages/settings-workspace"))
const NotFound = lazy(() => import("@/pages/not-found"))

const crumb = (label: RouteHandle["crumb"]): RouteHandle => ({ crumb: label })
const param = (name: string): RouteHandle => crumb((m) => String(m.params[name] ?? ""))

/** Every client route. `/` stays on the server-rendered page until the old UI is removed (F21). */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RootError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, Component: Dashboard, handle: crumb("Dashboard") },
          { path: "dashboard", Component: Dashboard, handle: crumb("Dashboard") },
          { path: "vault/*", Component: Vault, handle: crumb("Vault") },
          {
            path: "documents",
            handle: crumb("Documents"),
            children: [
              { index: true, Component: Documents },
              { path: ":id", Component: Document, handle: param("id") },
            ],
          },
          {
            path: "entities",
            handle: crumb("Entities"),
            children: [
              { index: true, Component: Entities },
              { path: ":id", Component: Entity, handle: param("id") },
            ],
          },
          {
            path: "generate",
            handle: crumb("Generate"),
            children: [
              { index: true, Component: Generate },
              { path: ":templateId", Component: Generate, handle: param("templateId") },
            ],
          },
          { path: "templates", Component: Templates, handle: crumb("Templates") },
          { path: "upload", Component: Upload, handle: crumb("Upload") },
          { path: "search", Component: Search, handle: crumb("Search") },
          {
            path: "settings",
            handle: crumb("Settings"),
            children: [
              { index: true, element: <Navigate to="/settings/brands" replace /> },
              {
                path: "brands",
                handle: crumb("Brands"),
                children: [
                  { index: true, Component: BrandsSettings },
                  { path: ":id", Component: BrandSettings, handle: param("id") },
                ],
              },
              { path: "numbering", Component: NumberingSettings, handle: crumb("Numbering") },
              { path: "workspace", Component: WorkspaceSettings, handle: crumb("Workspace") },
            ],
          },
          { path: "*", Component: NotFound, handle: crumb("Not found") },
        ],
      },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
