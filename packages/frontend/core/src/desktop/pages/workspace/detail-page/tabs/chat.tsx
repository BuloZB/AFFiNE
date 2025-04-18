import { ChatPanel } from '@affine/core/blocksuite/ai';
import type { AffineEditorContainer } from '@affine/core/blocksuite/block-suite-editor';
import { enableFootnoteConfigExtension } from '@affine/core/blocksuite/extensions';
import { AINetworkSearchService } from '@affine/core/modules/ai-button/services/network-search';
import { CollectionService } from '@affine/core/modules/collection';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { DocsSearchService } from '@affine/core/modules/docs-search';
import { SearchMenuService } from '@affine/core/modules/search-menu/services';
import { TagService } from '@affine/core/modules/tag';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { DocModeProvider } from '@blocksuite/affine/shared/services';
import {
  createSignalFromObservable,
  SpecProvider,
} from '@blocksuite/affine/shared/utils';
import { useFramework } from '@toeverything/infra';
import { forwardRef, useEffect, useRef } from 'react';

import * as styles from './chat.css';

export interface SidebarTabProps {
  editor: AffineEditorContainer | null;
  onLoad?: ((component: HTMLElement) => void) | null;
}

// A wrapper for CopilotPanel
export const EditorChatPanel = forwardRef(function EditorChatPanel(
  { editor, onLoad }: SidebarTabProps,
  ref: React.ForwardedRef<ChatPanel>
) {
  const chatPanelRef = useRef<ChatPanel | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const framework = useFramework();

  useEffect(() => {
    if (onLoad && chatPanelRef.current) {
      (chatPanelRef.current as ChatPanel).updateComplete
        .then(() => {
          if (ref) {
            if (typeof ref === 'function') {
              ref(chatPanelRef.current);
            } else {
              ref.current = chatPanelRef.current;
            }
          }
        })
        .catch(console.error);
    }
  }, [onLoad, ref]);

  useEffect(() => {
    if (!editor || !editor.host) return;

    if (!chatPanelRef.current) {
      chatPanelRef.current = new ChatPanel();
      chatPanelRef.current.host = editor.host;
      chatPanelRef.current.doc = editor.doc;

      const searchService = framework.get(AINetworkSearchService);
      const docDisplayMetaService = framework.get(DocDisplayMetaService);
      const workspaceService = framework.get(WorkspaceService);
      const searchMenuService = framework.get(SearchMenuService);
      const workbench = framework.get(WorkbenchService).workbench;
      const docsSearchService = framework.get(DocsSearchService);
      const tagService = framework.get(TagService);
      const collectionService = framework.get(CollectionService);
      const docsService = framework.get(DocsService);

      chatPanelRef.current.appSidebarConfig = {
        getWidth: () => {
          const width$ = workbench.sidebarWidth$;
          return createSignalFromObservable(width$, 0);
        },
        isOpen: () => {
          const open$ = workbench.sidebarOpen$;
          return createSignalFromObservable(open$, true);
        },
      };

      chatPanelRef.current.networkSearchConfig = {
        visible: searchService.visible,
        enabled: searchService.enabled,
        setEnabled: searchService.setEnabled,
      };

      chatPanelRef.current.docDisplayConfig = {
        getIcon: (docId: string) => {
          return docDisplayMetaService.icon$(docId, { type: 'lit' }).value;
        },
        getTitle: (docId: string) => {
          return docDisplayMetaService.title$(docId).value;
        },
        getTitleSignal: (docId: string) => {
          const title$ = docDisplayMetaService.title$(docId);
          return createSignalFromObservable(title$, '');
        },
        getDocMeta: (docId: string) => {
          const docRecord = docsService.list.doc$(docId).value;
          return docRecord?.meta$.value ?? null;
        },
        getDocPrimaryMode: (docId: string) => {
          const docRecord = docsService.list.doc$(docId).value;
          return docRecord?.primaryMode$.value ?? 'page';
        },
        getDoc: (docId: string) => {
          const doc = workspaceService.workspace.docCollection.getDoc(docId);
          return doc?.getStore() ?? null;
        },
        getReferenceDocs: (docIds: string[]) => {
          const docs$ = docsSearchService.watchRefsFrom(docIds);
          return createSignalFromObservable(docs$, []);
        },
        getTags: () => {
          const tagMetas$ = tagService.tagList.tagMetas$;
          return createSignalFromObservable(tagMetas$, []);
        },
        getTagTitle: (tagId: string) => {
          const tag$ = tagService.tagList.tagByTagId$(tagId);
          return tag$.value?.value$.value ?? '';
        },
        getTagPageIds: (tagId: string) => {
          const tag$ = tagService.tagList.tagByTagId$(tagId);
          if (!tag$) return [];
          return tag$.value?.pageIds$.value ?? [];
        },
        getCollections: () => {
          const collections$ = collectionService.collections$;
          return createSignalFromObservable(collections$, []);
        },
      };

      chatPanelRef.current.searchMenuConfig = {
        getDocMenuGroup: (query, action, abortSignal) => {
          return searchMenuService.getDocMenuGroup(query, action, abortSignal);
        },
        getTagMenuGroup: (query, action, abortSignal) => {
          return searchMenuService.getTagMenuGroup(query, action, abortSignal);
        },
        getCollectionMenuGroup: (query, action, abortSignal) => {
          return searchMenuService.getCollectionMenuGroup(
            query,
            action,
            abortSignal
          );
        },
      };

      chatPanelRef.current.previewSpecBuilder = enableFootnoteConfigExtension(
        SpecProvider._.getSpec('preview:page')
      );

      containerRef.current?.append(chatPanelRef.current);
    } else {
      chatPanelRef.current.host = editor.host;
      chatPanelRef.current.doc = editor.doc;
    }

    const docModeService = editor.host.std.get(DocModeProvider);
    const refNodeService = editor.host.std.getOptional(RefNodeSlotsProvider);
    const disposable = [
      refNodeService?.docLinkClicked.subscribe(({ host }) => {
        if (host === editor.host) {
          (chatPanelRef.current as ChatPanel).doc = editor.doc;
        }
      }),
      docModeService?.onPrimaryModeChange(() => {
        if (!editor.host) return;
        (chatPanelRef.current as ChatPanel).host = editor.host;
      }, editor.doc.id),
    ];

    return () => disposable.forEach(d => d?.unsubscribe());
  }, [editor, framework]);

  return <div className={styles.root} ref={containerRef} />;
});
