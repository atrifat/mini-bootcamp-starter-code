import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import { z } from "zod";
import { env } from "~/env";
import { LlamaParseReader } from "@llamaindex/cloud/reader";
import { documents, pages } from "~/server/db/schema";
import { eq } from "drizzle-orm";

async function getPdfContent(
  buffer: Buffer,
): Promise<{ pages: { number: number; content: string }[] }> {
  try {
    const reader = new LlamaParseReader({
      resultType: "markdown",
      apiKey: env.LLAMA_CLOUD_API_KEY,
    });
    const docs = await reader.loadDataAsContent(buffer);

    return {
      pages: docs.map((doc, index) => ({
        number: index + 1,
        content: doc.getText(),
      })),
    };
  } catch (error) {
    console.error("Error processing PDF:", error);
    throw new Error(
      "Failed to process PDF document: " + (error as Error).message,
    );
  }
}

export const documentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        fileUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!env.ELEVENLABS_API_KEY) {
        throw new Error("ElevenLabs API key is not configured");
      }

      try {
        // Fetch PDF from URL
        const response = await fetch(input.fileUrl);
        if (!response.ok) {
          throw new Error("Failed to fetch PDF file");
        }
        const fileBuffer = await response.arrayBuffer();

        // Extract text from PDF
        const { pages: pdfPages } = await getPdfContent(
          Buffer.from(fileBuffer),
        );

        // Save document
        const [doc] = await ctx.db
          .insert(documents)
          .values({
            name: input.name,
            createdById: ctx.session.user.id,
          })
          .returning();

        if (!doc) {
          throw new Error("Failed to create document");
        }

        // Process each page
        const documentPages = await Promise.all(
          pdfPages.map(async (page, index) => {
            try {
              // Save page
              const [savedPage] = await ctx.db
                .insert(pages)
                .values({
                  documentId: doc.id,
                  pageNumber: page.number,
                  content: page.content,
                })
                .returning();

              if (!savedPage) {
                throw new Error("Failed to save page");
              }

              return savedPage;
            } catch (error) {
              console.error(`Error processing page ${index + 1}:`, error);
              throw new Error(
                `Failed to process page ${index + 1}: ${(error as Error).message}`,
              );
            }
          }),
        );

        return {
          documentId: doc.id,
          pages: documentPages,
        };
      } catch (error) {
        console.error("Error creating document:", error);
        throw new Error(
          "Failed to create document: " + (error as Error).message,
        );
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Will be implemented later. For now, assume it's a simple check.
        // Check if the user has permission to delete documents.
        // const hasPermission = await checkUserPermission();
        const hasPermission = true;

        console.log("Delete document with id:", input.id);

        if (!hasPermission) {
          throw new Error(
            "You do not have permission to delete this document.",
          );
        }

        // Delete pages associated with the document.
        const deletedPages = await ctx.db
          .delete(pages)
          .where(eq(pages.documentId, input.id));

        if (!deletedPages) {
          throw new Error(
            "Failed to delete pages associated with the document.",
          );
        }

        // Delete the document itself.
        const deletedDocument = await ctx.db
          .delete(documents)
          .where(eq(documents.id, input.id));

        if (!deletedDocument) {
          throw new Error("Failed to delete document.");
        }
        return deletedDocument;
      } catch (error) {
        console.error("Error deleting document:", error);
        throw new Error(
          "Failed to delete document: " + (error as Error).message,
        );
      }
    }),
  getAll: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.documents.findMany({
      where: eq(documents.createdById, ctx.session.user.id),
      with: {
        pages: true,
      },
      orderBy: (documents, { desc }) => [desc(documents.createdAt)],
    });
  }),
});
