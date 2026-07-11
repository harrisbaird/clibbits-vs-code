import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  extractTextExcludingXclibbits,
  formatDocumentContent,
} from "../utils";

export class CopyScriptsRecursiveCommand {
  public static readonly commandName = "clibbits.copyScriptsRecursive";

  /**
   * Read the configured script extensions from settings and normalize them so
   * that each entry is lowercase and begins with a dot (e.g. "cs" -> ".cs").
   */
  private static getScriptExtensions(): string[] {
    const config = vscode.workspace.getConfiguration("clibbits");
    return config
      .get<string[]>("copyScriptsExtensions", [])
      .map((e) => e.toLowerCase())
      .map((e) => (e.startsWith(".") ? e : `.${e}`));
  }

  private static async collectFiles(
    folderPath: string,
    includeExtensions: string[],
    excludePatterns: RegExp[] = []
  ): Promise<string[]> {
    const results: string[] = [];

    try {
      const files = await fs.promises.readdir(folderPath);

      for (const file of files) {
        const fullPath = path.join(folderPath, file);
        const stats = await fs.promises.stat(fullPath);

        // Skip files/folders that match exclude patterns
        if (excludePatterns.some((pattern) => pattern.test(fullPath))) {
          continue;
        }

        if (stats.isDirectory()) {
          // Recursively process subdirectories
          const subFiles = await this.collectFiles(
            fullPath,
            includeExtensions,
            excludePatterns
          );
          results.push(...subFiles);
        } else {
          // Only include files whose extension is in the configured list
          const ext = path.extname(file).toLowerCase();
          if (includeExtensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing ${folderPath}:`, error);
    }

    return results;
  }

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(
      this.commandName,
      async (uri: vscode.Uri) => {
        try {
          if (!uri) {
            vscode.window.showInformationMessage("No folder selected.");
            return;
          }

          const stats = await fs.promises.stat(uri.fsPath);
          if (!stats.isDirectory()) {
            vscode.window.showInformationMessage(
              "Selected item is not a folder."
            );
            return;
          }

          const includeExtensions = this.getScriptExtensions();
          if (includeExtensions.length === 0) {
            vscode.window.showInformationMessage(
              "No script extensions configured. Set 'clibbits.copyScriptsExtensions' in settings (e.g. [\".cs\"])."
            );
            return;
          }

          // Default exclude patterns
          const excludePatterns = [
            /[\\/]node_modules[\\/]/,
            /[\\/]\.git[\\/]/,
            /[\\/]\.vscode[\\/]/,
            /[\\/]out[\\/]/,
            /[\\/]dist[\\/]/,
            /[\\/]build[\\/]/,
          ];

          // Show progress indicator
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Collecting scripts...",
              cancellable: false,
            },
            async (progress) => {
              // Collect all valid file paths
              const filePaths = await this.collectFiles(
                uri.fsPath,
                includeExtensions,
                excludePatterns
              );

              if (filePaths.length === 0) {
                vscode.window.showInformationMessage(
                  `No files matching ${includeExtensions.join(
                    ", "
                  )} found in the selected folder.`
                );
                return;
              }

              const contentBuilder: string[] = [];
              let processedFiles = 0;
              let totalSize = 0;

              for (const filePath of filePaths) {
                try {
                  const document = await vscode.workspace.openTextDocument(
                    vscode.Uri.file(filePath)
                  );
                  const content = extractTextExcludingXclibbits(document);

                  const workspaceFolder =
                    vscode.workspace.getWorkspaceFolder(uri);

                  // Add separator between files
                  if (processedFiles > 0) {
                    contentBuilder.push("\n");
                  }

                  contentBuilder.push(
                    formatDocumentContent(document, workspaceFolder)
                  );

                  processedFiles++;
                  totalSize += content.length;

                  // Check size limit (5MB)
                  if (totalSize > 5 * 1024 * 1024) {
                    throw new Error("Combined file size exceeds 5MB limit");
                  }

                  progress.report({
                    message: `Processed ${processedFiles} of ${filePaths.length} files`,
                    increment: (1 / filePaths.length) * 100,
                  });
                } catch (error) {
                  vscode.window.showWarningMessage(
                    `Failed to process ${path.basename(filePath)}: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`
                  );
                }
              }

              if (processedFiles > 0) {
                const combinedContent = contentBuilder.join("");
                await vscode.env.clipboard.writeText(combinedContent);
                vscode.window.showInformationMessage(
                  `Successfully copied ${processedFiles} script file(s) from ${path.basename(
                    uri.fsPath
                  )}`
                );
              }
            }
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to copy scripts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    );
  }
}
