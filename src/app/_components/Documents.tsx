"use client";

import { UploadButton } from "~/utils/uploadthing";
import { api } from "~/trpc/react";

/**
 * Component to display and manage documents.
 */
export function Documents() {
  // Get all available documents using the getAll query.
  const { data: documents, refetch: refetchDocuments } =
    api.document.getAll.useQuery();

  /**
   * Function to create a new document using the create mutation.
   */
  const createDocument = api.document.create.useMutation({
    onSuccess: async () => {
      // Refetch documents after successful creation.
      console.log("Document created successfully");
      await refetchDocuments();
    },
    onError: (error) => {
      // Log any errors that occur during document creation.
      console.error("Error creating document:", error);
    },
  });

  return (
    <div>
      {/* Upload button to upload new documents. */}
      <UploadButton
        endpoint="pdfUploader"
        onClientUploadComplete={async (res) => {
          // Check if the uploaded file is valid.
          if (!res?.[0]) return;
          console.log(res[0].url);
          // Create a new document using the file URL and name.
          await createDocument.mutateAsync({
            fileUrl: res[0].url,
            name: res[0].name,
          });
        }}
        onUploadError={(error: Error) => {
          // Log any errors that occur during upload.
          console.error(error.message);
        }}
        appearance={{
          button:
            "ut-ready:bg-green-500 ut-uploading:cursor-not-allowed bg-fuchsia-500 bg-none after:bg-fuchsia-400",
          container: "w-max flex-row mx-auto",
          allowedContent:
            "flex h-8 flex-col items-center justify-center px-2 text-white",
        }}
      />

      {/* Render all uploaded documents. */}
      {documents &&
        documents.map((document) => (
          <div
            className="mb-4 rounded-xl border bg-white/5 p-4 text-white"
            key={document.id}
          >
            <p>{document.name}</p>
            <p>Pages</p>
            {/* Render each page of the document. */}
            {document.pages.map((page) => (
              <div key={page.id}>
                <p>Page {page.pageNumber}</p>
                <p>{page.content}</p>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
