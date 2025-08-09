/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'express';

/**
 * Health check endpoint
 */
export function healthCheck(req: Request, res: Response) {
  res.status(200).json({ status: 'ok' });
}

/**
 * Get version information including git hash
 */
export function getVersion(req: Request, res: Response) {
  const server = req.app.locals.server;
  res.status(200).json({
    version: server.versionInfo?.version,
    buildTime: server.versionInfo?.buildTime,
    gitHash: server.versionInfo?.gitHash,
  });
}

/**
 * Get current agent information
 */
export function getAgentInfo(req: Request, res: Response) {
  const server = req.app.locals.server;
  res.status(200).json({
    name: server.getCurrentAgentName() || 'Unknown Agent',
  });
}

/**
 * Get available model providers and configurations
 */
export function getAvailableModels(req: Request, res: Response) {
  try {
    const server = req.app.locals.server;
    const availableModels = server.getAvailableModels();
    const defaultModel = server.getDefaultModelConfig();

    // Only return model lists, no sensitive information
    const modelsResponse = availableModels.map((provider) => ({
      provider: provider.name,
      models: provider.models,
    }));

    res.status(200).json({
      models: modelsResponse,
      defaultModel,
      hasMultipleProviders: availableModels.length > 0,
    });
  } catch (error) {
    console.error('Failed to get available models:', error);
    res.status(500).json({ error: 'Failed to get available models' });
  }
}

/**
 * Update session model configuration
 */
export async function updateSessionModel(req: Request, res: Response) {
  const { sessionId, provider, modelId } = req.body;
  const server = req.app.locals.server;

  if (!sessionId || !provider || !modelId) {
    return res
      .status(400)
      .json({ error: 'Missing required parameters: sessionId, provider, modelId' });
  }

  // Validate model configuration
  if (!server.isModelConfigValid(provider, modelId)) {
    return res.status(400).json({ error: 'Invalid model configuration' });
  }

  try {
    // Update session model configuration
    if (server.storageProvider) {
      const updatedMetadata = await server.storageProvider.updateSessionMetadata(sessionId, {
        modelConfig: {
          provider,
          modelId,
          configuredAt: Date.now(),
        },
        updatedAt: Date.now(),
      });

      // If session is currently active, log the change
      const activeSession = server.sessions[sessionId];
      if (activeSession) {
        console.log(`Session ${sessionId} model updated to ${provider}:${modelId}`);
        // Note: The model change will take effect on next agent creation/restart
      }

      res.status(200).json({
        success: true,
        sessionMetadata: updatedMetadata,
      });
    } else {
      res.status(400).json({ error: 'Storage not configured' });
    }
  } catch (error) {
    console.error('Failed to update session model:', error);
    res.status(500).json({ error: 'Failed to update session model' });
  }
}
