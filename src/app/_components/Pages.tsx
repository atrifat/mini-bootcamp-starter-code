import { useState } from "react";
import { api } from "~/trpc/react";

interface PagesProps {
  documentId: number;
  voice: string;
  pages: {
    documentId: number;
    id: number;
    createdAt: Date;
    pageNumber: number;
    content: string;
    audioFiles: {
      filePath: string;
      fileName: string;
      id: number;
    }[];
  }[];
  refetchDocuments: () => Promise<unknown>;
}

export function Pages({
  documentId,
  voice,
  pages,
  refetchDocuments,
}: PagesProps) {
  const [pageIdActive, setPageIdActive] = useState<null | number>(null);

  const generateAudio = api.document.generateAudioBook.useMutation({
    onSuccess: async () => {
      console.log("Audio generated successfully");
      await refetchDocuments();
      setPageIdActive(null);
    },
    onError: (error) => {
      console.error("Error generating audio:", error);
    },
  });

  function handleGenerateAudio(pageId: number) {
    try {
      setPageIdActive(pageId);
      generateAudio.mutate({ documentId, pageIds: [pageId], voice });
    } catch (error) {
      console.error("Error generating audio:", error);
    }
  }

  return (
    <div className="mt-8 grid gap-2">
      {pages.map((page) => (
        <div key={page.id} className="mb-2 rounded-lg bg-white/5 p-4">
          <div className="flex items-center gap-2">
            <p className="mb-2">Page {page.pageNumber}</p>
            {page.audioFiles.map((audioFile) => (
              <div key={audioFile.id} className="mt-4 flex-1">
                <audio controls className="w-full" src={audioFile.filePath}>
                  Your browser does not support the audio element.
                </audio>
              </div>
            ))}
          </div>
          <button
            className="flex items-center rounded-md bg-white/10 p-2 text-xs hover:bg-white/20 mt-2 mb-2"
            onClick={() => handleGenerateAudio(page.id)}
          >
            {generateAudio.isPending && pageIdActive === page.id && (
              <span className="mr-2 block size-4 animate-spin rounded-full border-2 border-dashed"></span>
            )}
            Generate audio
          </button>
        </div>
      ))}
    </div>
  );
}
