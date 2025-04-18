import {
  claimAudioTranscriptionMutation,
  getAudioTranscriptionQuery,
  retryAudioTranscriptionMutation,
  submitAudioTranscriptionMutation,
} from '@affine/graphql';
import { Entity } from '@toeverything/infra';

import type { DefaultServerService, WorkspaceServerService } from '../../cloud';
import { GraphQLService } from '../../cloud/services/graphql';
import type { WorkspaceService } from '../../workspace';

export class AudioTranscriptionJobStore extends Entity<{
  readonly blobId: string;
  readonly getAudioFile: () => Promise<File>;
}> {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly defaultServerService: DefaultServerService
  ) {
    super();
  }

  private get serverService() {
    return (
      this.workspaceServerService.server || this.defaultServerService.server
    );
  }

  private get graphqlService() {
    return this.serverService?.scope.get(GraphQLService);
  }

  private get currentWorkspaceId() {
    return this.workspaceService.workspace.id;
  }

  submitAudioTranscription = async () => {
    const graphqlService = this.graphqlService;
    if (!graphqlService) {
      throw new Error('No graphql service available');
    }
    const file = await this.props.getAudioFile();
    const response = await graphqlService.gql({
      query: submitAudioTranscriptionMutation,
      variables: {
        workspaceId: this.currentWorkspaceId,
        blobId: this.props.blobId,
        blob: file,
      },
    });
    if (!response.submitAudioTranscription?.id) {
      throw new Error('Failed to submit audio transcription');
    }
    return response.submitAudioTranscription;
  };

  retryAudioTranscription = async (jobId: string) => {
    const graphqlService = this.graphqlService;
    if (!graphqlService) {
      throw new Error('No graphql service available');
    }
    const response = await graphqlService.gql({
      query: retryAudioTranscriptionMutation,
      variables: {
        jobId,
        workspaceId: this.currentWorkspaceId,
      },
    });
    if (!response.retryAudioTranscription) {
      throw new Error('Failed to retry audio transcription');
    }
    return response.retryAudioTranscription;
  };

  getAudioTranscription = async (blobId: string, jobId?: string) => {
    const graphqlService = this.graphqlService;
    if (!graphqlService) {
      throw new Error('No graphql service available');
    }
    const currentWorkspaceId = this.currentWorkspaceId;
    if (!currentWorkspaceId) {
      throw new Error('No current workspace id');
    }
    const response = await graphqlService.gql({
      query: getAudioTranscriptionQuery,
      variables: {
        workspaceId: currentWorkspaceId,
        jobId,
        blobId,
      },
    });
    if (!response.currentUser?.copilot?.audioTranscription) {
      return null;
    }
    return response.currentUser.copilot.audioTranscription;
  };
  claimAudioTranscription = async (jobId: string) => {
    const graphqlService = this.graphqlService;
    if (!graphqlService) {
      throw new Error('No graphql service available');
    }
    const response = await graphqlService.gql({
      query: claimAudioTranscriptionMutation,
      variables: {
        jobId,
      },
    });
    if (!response.claimAudioTranscription) {
      throw new Error('Failed to claim transcription result');
    }
    return response.claimAudioTranscription;
  };
}
