import { FilePlusIcon, UploadIcon } from "lucide-react"
import { Link } from "react-router"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { DocumentsTable } from "@/features/documents/documents-table"

export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="Every document you can see, with filters by type, status, party and date."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/upload">
                <UploadIcon data-icon="inline-start" />
                Upload
              </Link>
            </Button>
            <Button asChild>
              <Link to="/generate">
                <FilePlusIcon data-icon="inline-start" />
                Generate
              </Link>
            </Button>
          </>
        }
      />
      <DocumentsTable />
    </>
  )
}
