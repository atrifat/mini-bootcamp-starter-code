import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

import { z } from "zod";
import { env } from "~/env";
import { LlamaParseReader } from "@llamaindex/cloud/reader";
import { eq, inArray } from "drizzle-orm";

import { ElevenLabsClient } from "elevenlabs";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { generateAudioTask } from "~/trigger/generate";
import { runs } from "@trigger.dev/sdk/v3";

import { documents, pages, audioFiles } from "~/server/db/schema";

const elevenlabs = new ElevenLabsClient({
  apiKey: env.ELEVENLABS_API_KEY,
});

const s3Client = new S3Client({
  region: "auto",
  endpoint: "https://fly.storage.tigris.dev",
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

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

        // Find the document to delete
        const documentResult = await ctx.db.query.documents.findFirst({
          where: eq(documents.id, input.id),
          with: {
            pages: {
              with: {
                audioFiles: true,
              },
            },
          },
        });

        // console.log("Document result:", JSON.stringify(documentResult, null, 2));

        const associatedPagesId =
          documentResult?.pages.map((page) => page.id) ?? [];
        // const associatedAudioFilesId = documentResult?.pages.flatMap(page => page.audioFiles).map(audioFile => audioFile.id) ?? [];

        // Delete audio files associated with the document.
        if (associatedPagesId.length > 0) {
          const deletedAudioFiles = await ctx.db
            .delete(audioFiles)
            .where(inArray(audioFiles.pageId, associatedPagesId));

          if (!deletedAudioFiles) {
            throw new Error(
              "Failed to delete audio files associated with the document.",
            );
          }
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
  generateAudioBook: protectedProcedure
    .input(
      z.object({
        documentId: z.number(),
        pageIds: z.array(z.number()),
        voice: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!env.ELEVENLABS_API_KEY) {
        throw new Error("ElevenLabs API key is not configured");
      }

      // Get the specified pages
      const pagesToRegenerate = await ctx.db.query.pages.findMany({
        where: inArray(pages.id, input.pageIds),
      });

      // Process each page
      const results = await Promise.all(
        pagesToRegenerate.map(async (page) => {
          try {
            const handle = await generateAudioTask.trigger({
              documentId: input.documentId,
              pageId: page.id,
              voice: input.voice,
              content: page.content,
            });
            const runId = handle.id;
            const run = await runs.retrieve<typeof generateAudioTask>(runId);

            return { pageId: page.id, success: true, runId };
          } catch (error) {
            console.error(
              `Error regenerating audio for page ${page.id}:`,
              error,
            );
            return {
              pageId: page.id,
              success: false,
              error: (error as Error).message,
            };
          }
        }),
      );

      return results;
    }),
  getJobStatus: protectedProcedure
    .input(
      z.object({
        runId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await runs.retrieve<typeof generateAudioTask>(input.runId);
      return run;
    }),
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const documentsResult = await ctx.db.query.documents.findMany({
      where: eq(documents.createdById, ctx.session.user.id),
      with: {
        pages: {
          with: {
            audioFiles: true,
          },
        },
      },
      orderBy: (documents, { desc }) => [desc(documents.createdAt)],
    });

    return documentsResult;
  }),
});
