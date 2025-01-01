"use client";

import { UploadButton } from "~/utils/uploadthing";
import { api } from "~/trpc/react";
import { Pages } from "./Pages";

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

  const deleteDocument = api.document.delete.useMutation({
    onSuccess: async () => {
      // Refetch documents after successful deletion.
      await refetchDocuments();
    },
    onError: (error) => {
      // Log any errors that occur during document deletion.
      console.error("Error deleting document:", error);
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
      {documents?.map((document) => (
        <div
          className="mb-4 rounded-xl border bg-white/5 p-4 text-white"
          key={document.id}
        >
          <div className="flex items-center justify-between">
            <div className="justify-left flex flex-col items-center">
              <p>{document.name}</p>
            </div>

            <button
              className="mb-2 mt-2 rounded bg-red-500 px-4 py-2 font-bold text-white hover:bg-red-700"
              onClick={() => deleteDocument.mutateAsync({ id: document.id })}
            >
              Delete
            </button>
          </div>

          {/* Render each page of the document. */}
          <Pages
            documentId={document.id}
            documentName={document.name}
            pages={document.pages}
            refetchDocuments={refetchDocuments}
            voice={"my2nUXZc8WyNijMOfltw"}
          />
        </div>
      ))}
    </div>
  );
}
