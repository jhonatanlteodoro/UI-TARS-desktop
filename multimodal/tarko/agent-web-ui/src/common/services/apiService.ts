import { API_BASE_URL, API_ENDPOINTS } from '@/common/constants';
import { AgentEventStream, SessionMetadata, AgentInfo } from '@/common/types';
import { socketService } from './socketService';
import { ChatCompletionContentPart } from '@tarko/agent-interface';
import { AgentServerVersionInfo } from '@agent-tars/interface';

/**
 * Workspace item interface for contextual selector
 */
export interface WorkspaceItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  relativePath: string;
}

/**
 * Available models response interface
 */
export interface AvailableModelsResponse {
  models: Array<{
    provider: string;
    models: string[];
  }>;
  defaultModel: {
    provider: string;
    modelId: string;
  };
  hasMultipleProviders: boolean;
}

/**
 * API Service - Handles HTTP requests to the Agent TARS Server
 *
 * Provides methods for:
 * - Session management (create, get, update, delete)
 * - Query execution (streaming and non-streaming)
 * - Server health checks
 * - Version information
 * - Agent information
 * - Workspace file search
 */
class ApiService {
  /**
   * Check server health status
   */
  async checkServerHealth(): Promise<boolean> {
    try {
      // Try ping through socket if connected
      if (socketService.isConnected()) {
        const pingSuccessful = await socketService.ping();
        if (pingSuccessful) return true;
      }

      // Fall back to API health endpoint
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.HEALTH}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      return response.ok;
    } catch (error) {
      console.error('Error checking server health:', error);
      return false;
    }
  }

  /**
   * Create a new session
   */
  async createSession(): Promise<SessionMetadata> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CREATE_SESSION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const { sessionId } = await response.json();
      return this.getSessionDetails(sessionId);
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Get all sessions
   */
  async getSessions(): Promise<SessionMetadata[]> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.SESSIONS}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to get sessions: ${response.statusText}`);
      }

      const { sessions } = await response.json();
      return sessions;
    } catch (error) {
      console.error('Error getting sessions:', error);
      throw error;
    }
  }

  /**
   * Get details for a specific session
   */
  async getSessionDetails(sessionId: string): Promise<SessionMetadata> {
    try {
      const response = await fetch(
        `${API_BASE_URL}${API_ENDPOINTS.SESSION_DETAILS}?sessionId=${sessionId}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000), // Add 5 second timeout
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get session details: ${response.statusText}`);
      }

      const { session } = await response.json();
      return session;
    } catch (error) {
      console.error(`Error getting session details (${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Get events for a specific session
   */
  async getSessionEvents(sessionId: string): Promise<AgentEventStream.Event[]> {
    try {
      const response = await fetch(
        `${API_BASE_URL}${API_ENDPOINTS.SESSION_EVENTS}?sessionId=${sessionId}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000), // Add 5 second timeout
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get session events: ${response.statusText}`);
      }

      const { events } = await response.json();
      return events;
    } catch (error) {
      console.error(`Error getting session events (${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Get current status of a session
   */
  async getSessionStatus(sessionId: string): Promise<{ isProcessing: boolean; state: string }> {
    try {
      const response = await fetch(
        `${API_BASE_URL}${API_ENDPOINTS.SESSION_STATUS}?sessionId=${sessionId}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3000), // 3 second timeout
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get session status: ${response.statusText}`);
      }

      const { status } = await response.json();
      return status;
    } catch (error) {
      console.error(`Error getting session status (${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Update session metadata
   */
  async updateSessionMetadata(
    sessionId: string,
    updates: { name?: string; tags?: string[] },
  ): Promise<SessionMetadata> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.UPDATE_SESSION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...updates }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update session: ${response.statusText}`);
      }

      const { session } = await response.json();
      return session;
    } catch (error) {
      console.error(`Error updating session (${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.DELETE_SESSION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to delete session: ${response.statusText}`);
      }

      const { success } = await response.json();
      return success;
    } catch (error) {
      console.error(`Error deleting session (${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Send a streaming query
   */
  async sendStreamingQuery(
    sessionId: string,
    query: string | ChatCompletionContentPart[],
    onEvent: (event: AgentEventStream.Event) => void,
  ): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.QUERY_STREAM}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, query }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send query: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add the new chunk to the buffer
        buffer += decoder.decode(value, { stream: true });

        // Process all complete events in the buffer
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const eventString = buffer.slice(0, eventEndIndex);
          // Move buffer to the next event
          buffer = buffer.slice(eventEndIndex + 2);

          if (eventString.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(eventString.substring(6));
              onEvent(eventData);
            } catch (e) {
              console.error('Error parsing event data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in streaming query:', error);
      throw error;
    }
  }

  /**
   * Send a non-streaming query
   */
  async sendQuery(sessionId: string, query: string | ChatCompletionContentPart[]): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.QUERY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, query }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send query: ${response.statusText}`);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error sending query:', error);
      throw error;
    }
  }

  /**
   * Abort a running query
   */
  async abortQuery(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.ABORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to abort query: ${response.statusText}`);
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error('Error aborting query:', error);
      throw error;
    }
  }

  /**
   * Generate a summary for a conversation
   */
  async generateSummary(sessionId: string, messages: any[]): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.GENERATE_SUMMARY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate summary: ${response.statusText}`);
      }

      const { summary } = await response.json();
      return summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      return 'Untitled Conversation';
    }
  }

  /**
   * Get application version information including git hash
   * In replay mode, use injected version info instead of making API request
   */
  async getVersionInfo(): Promise<AgentServerVersionInfo> {
    // Check if version info is injected in replay/share mode
    if (window.AGENT_VERSION_INFO) {
      return window.AGENT_VERSION_INFO;
    }

    // Fallback to API request for normal mode
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.VERSION}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Failed to get version info: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        version: data.version || '0.0.0',
        buildTime:
          typeof data.buildTime === 'string'
            ? parseInt(data.buildTime)
            : data.buildTime || Date.now(),
        gitHash: data.gitHash,
      };
    } catch (error) {
      console.error('Error getting version info:', error);
      return { version: '0.0.0', buildTime: Date.now() };
    }
  }

  /**
   * Get current agent information
   */
  async getAgentInfo(): Promise<AgentInfo> {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AGENT_INFO}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Failed to get agent info: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        name: data.name || 'Unknown Agent',
      };
    } catch (error) {
      console.error('Error getting agent info:', error);
      return { name: 'Unknown Agent' };
    }
  }

  /**
   * Search workspace files and directories for contextual selector
   */
  async searchWorkspaceItems(
    sessionId: string,
    query: string,
    type?: 'file' | 'directory' | 'all',
  ): Promise<WorkspaceItem[]> {
    try {
      const params = new URLSearchParams({
        sessionId,
        q: query,
        ...(type && { type }),
      });

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.WORKSPACE_SEARCH}?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Failed to search workspace items: ${response.statusText}`);
      }

      const { items } = await response.json();
      return items;
    } catch (error) {
      console.error('Error searching workspace items:', error);
      return [];
    }
  }

  /**
   * Get available model providers and configurations
   */
  async getAvailableModels(): Promise<AvailableModelsResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Failed to get available models: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting available models:', error);
      return {
        models: [],
        defaultModel: { provider: '', modelId: '' },
        hasMultipleProviders: false,
      };
    }
  }

  /**
   * Update session model configuration
   */
  async updateSessionModel(sessionId: string, provider: string, modelId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, provider, modelId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update session model: ${response.statusText}`);
      }

      const { success } = await response.json();
      return success;
    } catch (error) {
      console.error('Error updating session model:', error);
      return false;
    }
  }
}

// Export singleton instance
export const apiService = new ApiService();
