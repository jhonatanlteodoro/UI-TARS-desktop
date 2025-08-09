/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { SessionMetadata } from '../../storage';
import { AgentSession } from '../../core';
import { ShareService } from '../../services';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get all sessions
 */
export async function getAllSessions(req: Request, res: Response) {
  try {
    const server = req.app.locals.server;

    if (!server.storageProvider) {
      // If no storage, return only active sessions
      const activeSessions = Object.keys(server.sessions).map((id) => ({
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      return res.status(200).json({ sessions: activeSessions });
    }

    // Get all sessions from storage
    const sessions = await server.storageProvider.getAllSessions();

    res.status(200).json({ sessions });
  } catch (error) {
    console.error('Failed to get sessions:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
}

/**
 * Create a new session
 */
export async function createSession(req: Request, res: Response) {
  try {
    const server = req.app.locals.server;

    const sessionId = nanoid();

    // Get session metadata if it exists (for restored sessions)
    let sessionMetadata = null;
    if (server.storageProvider) {
      try {
        sessionMetadata = await server.storageProvider.getSessionMetadata(sessionId);
      } catch (error) {
        // Session doesn't exist yet, will be created below
      }
    }

    // Pass custom AGIO provider and session metadata if available
    const session = new AgentSession(
      server,
      sessionId,
      server.getCustomAgioProvider(),
      sessionMetadata || undefined,
    );

    server.sessions[sessionId] = session;

    const { storageUnsubscribe } = await session.initialize();

    // Save unsubscribe function for cleanup
    if (storageUnsubscribe) {
      server.storageUnsubscribes[sessionId] = storageUnsubscribe;
    }

    // Store session metadata if we have storage
    if (server.storageProvider) {
      const metadata: SessionMetadata = {
        id: sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspace: server.getCurrentWorkspace(),
      };

      await server.storageProvider.createSession(metadata);
    }

    res.status(201).json({ sessionId });
  } catch (error) {
    console.error('Failed to create session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
}

/**
 * Get session details
 */
export async function getSessionDetails(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;

    // Check storage first
    if (server.storageProvider) {
      const metadata = await server.storageProvider.getSessionMetadata(sessionId);
      if (metadata) {
        return res.status(200).json({
          session: metadata,
        });
      }
    }

    return res.status(404).json({ error: 'Session not found' });
  } catch (error) {
    console.error(`Error getting session details for ${sessionId}:`, error);
    res.status(500).json({ error: 'Failed to get session details' });
  }
}

/**
 * Get session events
 */
export async function getSessionEvents(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;

    if (!server.storageProvider) {
      return res.status(404).json({ error: 'Storage not configured, no events available' });
    }

    const events = await server.storageProvider.getSessionEvents(sessionId);
    res.status(200).json({ events });
  } catch (error) {
    console.error(`Error getting events for session ${sessionId}:`, error);
    res.status(500).json({ error: 'Failed to get session events' });
  }
}

/**
 * Get session status
 */
export async function getSessionStatus(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const session = req.session as AgentSession;

    const isProcessing = session.getProcessingStatus();

    res.status(200).json({
      sessionId,
      status: {
        isProcessing,
        state: session.agent.status(),
      },
    });
  } catch (error) {
    console.error(`Error getting session status (${sessionId}):`, error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
}

/**
 * Update session metadata
 */
export async function updateSession(req: Request, res: Response) {
  const { sessionId, name, tags } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;

    if (!server.storageProvider) {
      return res.status(404).json({ error: 'Storage not configured, cannot update session' });
    }

    const metadata = await server.storageProvider.getSessionMetadata(sessionId);
    if (!metadata) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const updatedMetadata = await server.storageProvider.updateSessionMetadata(sessionId, {
      name,
      tags,
      updatedAt: Date.now(),
    });

    res.status(200).json({ session: updatedMetadata });
  } catch (error) {
    console.error(`Error updating session ${sessionId}:`, error);
    res.status(500).json({ error: 'Failed to update session' });
  }
}

/**
 * Delete a session
 */
export async function deleteSession(req: Request, res: Response) {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;

    // Close active session if exists
    if (server.sessions[sessionId]) {
      // Before clearing the session, try dispose the agent first
      try {
        const agent = server.sessions[sessionId].agent;
        if (agent) {
          agent.dispose();
        }
      } catch (error) {
        console.warn(
          `Failed to cleanup agent for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await server.sessions[sessionId].cleanup();
      delete server.sessions[sessionId];

      // Clean up storage unsubscribe
      if (server.storageUnsubscribes[sessionId]) {
        server.storageUnsubscribes[sessionId]();
        delete server.storageUnsubscribes[sessionId];
      }
    }

    // Delete from storage if configured
    if (server.storageProvider) {
      const deleted = await server.storageProvider.deleteSession(sessionId);
      if (!deleted) {
        return res.status(404).json({ error: 'Session not found in storage' });
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
}

/**
 * Generate summary for a session
 */
export async function generateSummary(req: Request, res: Response) {
  const { sessionId, messages, model, provider } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages are required' });
  }

  try {
    const server = req.app.locals.server;
    const session = server.sessions[sessionId];

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // FIXME: Use smaller messages to generate summaries
    // Generate summary using the agent's method
    const summaryResponse = await session.agent.generateSummary({
      messages,
      model,
      provider,
    });

    // Return the summary
    res.status(200).json(summaryResponse);
  } catch (error) {
    console.error(`Error generating summary for session ${sessionId}:`, error);
    res.status(500).json({
      error: 'Failed to generate summary',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Share a session
 */
export async function shareSession(req: Request, res: Response) {
  const { sessionId, upload } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;
    const shareService = new ShareService(server.appConfig, server.storageProvider);

    // Get agent instance if session is active (for slug generation)
    const agent = server.sessions[sessionId]?.agent;
    const result = await shareService.shareSession(sessionId, upload, agent, server.versionInfo);
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(500).json({
        error: result.error || 'Failed to share session',
      });
    }
  } catch (error) {
    console.error(`Error sharing session ${sessionId}:`, error);
    return res.status(500).json({ error: 'Failed to share session' });
  }
}

/**
 * Get events from the latest updated session
 */
export async function getLatestSessionEvents(req: Request, res: Response) {
  try {
    const server = req.app.locals.server;

    if (!server.storageProvider) {
      return res
        .status(404)
        .json({ error: 'Storage not configured, cannot get latest session events' });
    }

    // Get all sessions
    const sessions = await server.storageProvider.getAllSessions();

    if (sessions.length === 0) {
      return res.status(404).json({ error: 'No sessions found' });
    }

    // Find the session with the most recent updatedAt timestamp
    const latestSession = sessions.reduce((latest, current) => {
      return current.updatedAt > latest.updatedAt ? current : latest;
    });

    // Get events for the latest session
    const events = await server.storageProvider.getSessionEvents(latestSession.id);

    res.status(200).json({
      sessionId: latestSession.id,
      sessionMetadata: latestSession,
      events,
    });
  } catch (error) {
    console.error('Error getting latest session events:', error);
    res.status(500).json({ error: 'Failed to get latest session events' });
  }
}

/**
 * Get session workspace files
 */
export async function getSessionWorkspaceFiles(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;
  const requestPath = (req.query.path as string) || '/';

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    const server = req.app.locals.server;
    const session = server.sessions[sessionId];

    // Check if session exists (active or stored)
    if (!session && server.storageProvider) {
      const metadata = await server.storageProvider.getSessionMetadata(sessionId);
      if (!metadata) {
        return res.status(404).json({ error: 'Session not found' });
      }
    } else if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const baseWorkspacePath = server.getCurrentWorkspace();

    // Build potential file paths
    const pathsToCheck: string[] = [];

    pathsToCheck.push(path.join(baseWorkspacePath, requestPath));

    // Find the first existing path
    let targetPath: string | null = null;
    for (const checkPath of pathsToCheck) {
      const normalizedPath = path.resolve(checkPath);
      const normalizedWorkspace = path.resolve(baseWorkspacePath);

      // Security check
      if (normalizedPath.startsWith(normalizedWorkspace) && fs.existsSync(normalizedPath)) {
        targetPath = normalizedPath;
        break;
      }
    }

    if (!targetPath) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = fs.statSync(targetPath);

    if (stats.isFile()) {
      // Return file info
      return res.json({
        type: 'file',
        name: path.basename(targetPath),
        size: stats.size,
        modified: stats.mtime,
        path: requestPath,
      });
    } else if (stats.isDirectory()) {
      // Return directory listing
      const files = fs.readdirSync(targetPath).map((file) => {
        const filePath = path.join(targetPath, file);
        const fileStats = fs.statSync(filePath);
        return {
          name: file,
          isDirectory: fileStats.isDirectory(),
          size: fileStats.size,
          modified: fileStats.mtime,
          path: path.join(requestPath, file).replace(/\\/g, '/'),
        };
      });

      return res.json({
        type: 'directory',
        path: requestPath,
        files: files.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        }),
      });
    }

    return res.status(400).json({ error: 'Invalid path type' });
  } catch (error) {
    console.error(`Error accessing workspace files for session ${sessionId}:`, error);
    res.status(500).json({
      error: 'Failed to access workspace files',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Search files and directories in session workspace
 */
export async function searchWorkspaceItems(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;
  const query = req.query.q as string;
  const type = req.query.type as 'file' | 'directory' | 'all';

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  // Allow empty query for default directory listing
  if (query === undefined || query === null) {
    return res.status(400).json({ error: 'Search query parameter is required' });
  }

  try {
    const server = req.app.locals.server;
    const baseWorkspacePath = server.getCurrentWorkspace();

    let items: Array<{
      name: string;
      path: string;
      type: 'file' | 'directory';
      relativePath: string;
    }>;

    if (query.length === 0) {
      // Empty query: return current directory contents (top-level files and directories)
      items = await getWorkspaceRootItems(baseWorkspacePath, type || 'all');
    } else {
      // Non-empty query: search recursively
      items = await searchWorkspaceItemsRecursive(baseWorkspacePath, query, type || 'all');
    }

    // Limit results to avoid overwhelming the UI
    const limitedItems = items.slice(0, 20);

    res.status(200).json({ items: limitedItems });
  } catch (error) {
    console.error(`Error searching workspace items for session ${sessionId}:`, error);
    res.status(500).json({
      error: 'Failed to search workspace items',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Recursively search for files and directories
 */
async function searchWorkspaceItemsRecursive(
  basePath: string,
  query: string,
  type: 'file' | 'directory' | 'all',
): Promise<
  Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }>
> {
  const items: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    relativePath: string;
  }> = [];

  const searchInDirectory = async (currentPath: string, depth = 0) => {
    // Limit recursion depth to avoid performance issues
    if (depth > 5) return;

    try {
      const entries = fs.readdirSync(currentPath);

      for (const entry of entries) {
        // Skip hidden files and common ignore patterns
        if (entry.startsWith('.') || entry === 'node_modules' || entry === '.git') {
          continue;
        }

        const fullPath = path.join(currentPath, entry);
        const stats = fs.statSync(fullPath);
        const relativePath = path.relative(basePath, fullPath);

        // Check if name matches query (case-insensitive)
        if (entry.toLowerCase().includes(query.toLowerCase())) {
          const itemType = stats.isDirectory() ? 'directory' : 'file';

          if (type === 'all' || type === itemType) {
            items.push({
              name: entry,
              path: fullPath,
              type: itemType,
              relativePath: relativePath.replace(/\\/g, '/'), // Normalize path separators
            });
          }
        }

        // Recursively search in subdirectories
        if (stats.isDirectory()) {
          await searchInDirectory(fullPath, depth + 1);
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`Cannot read directory ${currentPath}:`, error);
    }
  };

  await searchInDirectory(basePath);

  // Sort by type (directories first) then by name
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get root level items in workspace
 */
async function getWorkspaceRootItems(
  basePath: string,
  type: 'file' | 'directory' | 'all',
): Promise<
  Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }>
> {
  const items: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    relativePath: string;
  }> = [];

  try {
    const entries = fs.readdirSync(basePath);

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.startsWith('.') || entry === 'node_modules' || entry === '.git') {
        continue;
      }

      const fullPath = path.join(basePath, entry);
      const stats = fs.statSync(fullPath);
      const itemType = stats.isDirectory() ? 'directory' : 'file';

      if (type === 'all' || type === itemType) {
        items.push({
          name: entry,
          path: fullPath,
          type: itemType,
          relativePath: entry,
        });
      }
    }
  } catch (error) {
    console.warn(`Cannot read directory ${basePath}:`, error);
  }

  // Sort by type (directories first) then by name
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
