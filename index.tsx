/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useCallback,
  useMemo,
  FC,
  Dispatch,
  ReactNode,
} from 'react';
import ReactDOM from 'react-dom/client';

// --- 0. TRANSLATIONS ---
const t = {
  title: 'URLコンテンツダウンローダー',
  subtitle: 'URLを入力してコンテンツを抽出し、ダウンロードします。',
  urlListLabel: 'URLリスト（1行に1つ）',
  urlListPlaceholder: 'https://example.com/page1\nhttps://example.com/page2',
  downloadFormatLabel: 'ダウンロード形式',
  individualFiles: '個別ファイル (.txt)',
  zipArchive: 'ZIPアーカイブ (.zip)',
  combinedText: '結合テキストファイル (.txt)',
  maxSizeLabel: '最大サイズ (KB)',
  extract: '抽出を開始',
  retryFailed: '失敗を再試行',
  clearCompleted: '完了をクリア',
  clearAll: 'すべてクリア',
  ariaExtract: 'URLのコンテンツ抽出を開始',
  ariaRetry: '失敗したダウンロードを再試行',
  ariaClearCompleted: '完了したダウンロードをクリア',
  ariaClearAll: 'すべての履歴をクリア',
  downloadSectionTitle: 'ダウンロードオプション',
  downloadTarget: 'ダウンロード対象',
  downloadByUrl: 'URL単位で選択',
  downloadAll: '完了したものをすべてダウンロード',
  selectUrlsForDownload: 'ダウンロードするURLを選択してください:',
  download: 'ダウンロード',
  ariaDownload: '選択したオプションでダウンロードを開始',
  filters: {
    all: 'すべて',
    completed: '完了',
    pending: '待機中',
    error: 'エラー',
  },
  status: {
    pending: '待機中',
    completed: '完了',
    error: 'エラー',
  },
  noItemsToDisplay: '表示する項目がありません。',
  noDownloadHistory: 'ダウンロード履歴はありません。',
  noCompletedItems: 'ダウンロード可能な完了済み項目がありません。'
};

// --- 1. TYPES ---
declare var JSZip: any;

type ProgressStatus = 'pending' | 'completed' | 'error';
type DownloadType = 'individual' | 'zip' | 'combined-text';
type DownloadTarget = 'selected' | 'all';

interface ProgressItem {
  status: ProgressStatus;
  error?: string;
  content?: string; // To hold fetched file content
}

interface State {
  urlsToProcess: string;
  downloadOptions: {
    type: DownloadType;
    maxSize: number;
  };
  progress: {
    [url: string]: ProgressItem;
  };
  isProcessing: boolean;
  selectedUrlsForDownload: Set<string>;
  downloadTarget: DownloadTarget;
}

type Action =
  | { type: 'SET_URLS'; payload: string }
  | { type: 'SET_DOWNLOAD_OPTIONS'; payload: { type?: DownloadType; maxSize?: number }; }
  | { type: 'PROGRESS_UPDATE'; payload: { [url: string]: ProgressItem } }
  | { type: 'START_PROCESSING' }
  | { type: 'FINISH_PROCESSING' }
  | { type: 'CLEAR_PROGRESS'; payload: 'all' | 'completed' | 'failed' }
  | { type: 'SET_DOWNLOAD_TARGET', payload: DownloadTarget }
  | { type: 'TOGGLE_URL_SELECTION', payload: string };

// --- 1.5 INDEXEDDB HELPER ---
const DB_NAME = 'UrlDownloaderDB';
const STORE_NAME = 'appState';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const dbRequest = async <T,>(
  type: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest
): Promise<T> => {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, type);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const idb = {
  get: <T,>(key: IDBValidKey): Promise<T | undefined> =>
    dbRequest('readonly', store => store.get(key)),
  set: (key: IDBValidKey, value: any): Promise<IDBValidKey> =>
    dbRequest('readwrite', store => store.put(value, key)),
  clear: (): Promise<void> =>
    dbRequest('readwrite', store => store.clear()),
};


// --- 2. STATE MANAGEMENT (CONTEXT & REDUCER) ---

const initialState: State = {
  urlsToProcess: '',
  downloadOptions: {
    type: 'individual',
    maxSize: 1024,
  },
  progress: {},
  isProcessing: false,
  selectedUrlsForDownload: new Set(),
  downloadTarget: 'selected',
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_URLS':
      return { ...state, urlsToProcess: action.payload };
    case 'SET_DOWNLOAD_OPTIONS':
      return { ...state, downloadOptions: { ...state.downloadOptions, ...action.payload } };
    case 'PROGRESS_UPDATE':
      return { ...state, progress: action.payload };
    case 'START_PROCESSING':
      return { ...state, isProcessing: true };
    case 'FINISH_PROCESSING':
      return { ...state, isProcessing: false };
    case 'CLEAR_PROGRESS':
      {
        if (action.payload === 'all') {
            return { ...state, urlsToProcess: '', progress: {}, selectedUrlsForDownload: new Set() };
        }
        const newProgress = { ...state.progress };
        const newSelection = new Set(state.selectedUrlsForDownload);
        Object.entries(newProgress).forEach(([url, item]) => {
            if (
                (action.payload === 'completed' && item.status === 'completed') ||
                (action.payload === 'failed' && item.status === 'error')
            ) {
                delete newProgress[url];
                newSelection.delete(url);
            }
        });
        return { ...state, progress: newProgress, selectedUrlsForDownload: newSelection };
      }
    case 'SET_DOWNLOAD_TARGET':
        return { ...state, downloadTarget: action.payload };
    case 'TOGGLE_URL_SELECTION':
        const newSelection = new Set(state.selectedUrlsForDownload);
        if (newSelection.has(action.payload)) {
            newSelection.delete(action.payload);
        } else {
            newSelection.add(action.payload);
        }
        return { ...state, selectedUrlsForDownload: newSelection };
    default:
      return state;
  }
};

interface ProgressContextValue {
  state: State;
  dispatch: Dispatch<Action>;
}

const ProgressContext = createContext<ProgressContextValue | undefined>(undefined);

const ProgressProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const loadState = async () => {
        try {
            const storedProgress = await idb.get<{[url: string]: ProgressItem}>('progress');
            if (storedProgress) {
                dispatch({ type: 'PROGRESS_UPDATE', payload: storedProgress });
            }
        } catch (error) {
            console.error("Failed to load state from IndexedDB", error);
        } finally {
            setIsInitialized(true);
        }
    };
    loadState();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    try {
       idb.set('progress', state.progress);
    } catch (error) {
        console.error("Failed to save state to IndexedDB", error);
    }
  }, [state.progress, isInitialized]);

  return (
    <ProgressContext.Provider value={{ state, dispatch }}>
      {children}
    </ProgressContext.Provider>
  );
};

const useProgressContext = () => {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgressContext must be used within a ProgressProvider');
  return context;
};

// --- 3. CUSTOM HOOKS & API LOGIC ---

const fetchUrlContent = async (url: string): Promise<ProgressItem> => {
    try {
      const fetchUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(fetchUrl);
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
      }
  
      const content = await response.text();
      return {
        status: 'completed',
        content: content,
      };
    } catch (error: any) {
      console.error(`Failed to fetch content for ${url}:`, error);
      return {
        status: 'error',
        error: error.message || 'Failed to fetch content',
      };
    }
  };

const useAppActions = () => {
  const { state, dispatch } = useProgressContext();

  const processUrls = useCallback(async (urls: string[]) => {
    if (urls.length === 0) {
      dispatch({ type: 'FINISH_PROCESSING' });
      return;
    }

    let currentProgress = { ...state.progress };
    urls.forEach(url => {
        if (url) currentProgress[url] = { status: 'pending' };
    });
    dispatch({ type: 'PROGRESS_UPDATE', payload: currentProgress });
    
    for (const url of urls) {
        if (!url) continue;
        const result = await fetchUrlContent(url);
        currentProgress = { ...currentProgress, [url]: result };
        dispatch({ type: 'PROGRESS_UPDATE', payload: currentProgress });
    }

    dispatch({ type: 'FINISH_PROCESSING' });
  }, [state.progress, dispatch]);

  const startExtraction = useCallback(() => {
    const urls = state.urlsToProcess.split('\n').filter(url => url.trim() !== '');
    if (urls.length === 0) return;
    dispatch({ type: 'START_PROCESSING' });
    processUrls(urls);
  }, [state.urlsToProcess, dispatch, processUrls]);

  const retryFailed = useCallback(() => {
    const failedUrls = Object.entries(state.progress)
      .filter(([, item]) => item.status === 'error')
      .map(([url]) => url);
    if (failedUrls.length === 0) return;
    dispatch({ type: 'START_PROCESSING' });
    processUrls(failedUrls);
  }, [state.progress, dispatch, processUrls]);

  const clearHistory = useCallback(async (type: 'all' | 'completed' | 'failed') => {
      if (type === 'all') {
        try {
          await idb.clear();
        } catch (error) {
          console.error("Failed to clear IndexedDB", error);
        }
      }
      dispatch({ type: 'CLEAR_PROGRESS', payload: type });
    }, [dispatch]);

  const startDownload = useCallback(async () => {
    const { downloadTarget, selectedUrlsForDownload, downloadOptions, progress } = state;
    
    dispatch({ type: 'START_PROCESSING' });

    try {
        let urlsToConsider: string[];
        if (downloadTarget === 'selected') {
            urlsToConsider = Array.from(selectedUrlsForDownload);
        } else {
            urlsToConsider = Object.entries(progress)
                .filter(([, item]) => item.status === 'completed')
                .map(([url]) => url);
        }

        let totalSize = 0;
        const maxSizeInBytes = downloadOptions.maxSize > 0 ? downloadOptions.maxSize * 1024 : Infinity;
        const itemsToDownload: { url: string, content: string }[] = [];

        for (const url of urlsToConsider) {
            const item = progress[url];
            if (item?.status === 'completed' && item.content) {
                const contentBytes = new TextEncoder().encode(item.content).length;
                if ((totalSize + contentBytes) > maxSizeInBytes) {
                    console.warn(`Stopping before adding ${url} as it would exceed the max size limit of ${downloadOptions.maxSize} KB.`);
                    break; 
                }
                totalSize += contentBytes;
                itemsToDownload.push({ url, content: item.content });
            }
        }
        
        if (itemsToDownload.length === 0) {
            alert("ダウンロード対象のファイルがありません。");
            return;
        }

        switch (downloadOptions.type) {
            case 'individual':
                for (const { url, content } of itemsToDownload) {
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    const filename = url.replace(/[^a-zA-Z0-9.-]/g, '_') + '.txt';
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                break;
            
            // FIX: Add block scope to case to prevent variable redeclaration error.
            case 'zip': {
                if (typeof JSZip === 'undefined') {
                    alert('ZIPライブラリがロードされていません。');
                    console.error('JSZip is not defined.');
                    return;
                }
                const zip = new JSZip();
                for (const { url, content } of itemsToDownload) {
                    const filename = url.replace(/[^a-zA-Z0-9.-]/g, '_') + '.txt';
                    zip.file(filename, content);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(zipBlob);
                link.download = 'downloaded_content.zip';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                break;
            }

            // FIX: Add block scope to case to prevent variable redeclaration error.
            case 'combined-text': {
                const combinedContent = itemsToDownload
                    .map(({ url, content }) => `--- Content from: ${url} ---\n\n${content}`)
                    .join('\n\n\n');
                const blob = new Blob([combinedContent], { type: 'text/plain;charset=utf-8' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'combined_content.txt';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                break;
            }
        }
    } catch (error) {
        console.error("Download failed:", error);
        alert("ダウンロード中にエラーが発生しました。");
    } finally {
        dispatch({ type: 'FINISH_PROCESSING' });
    }
  }, [state, dispatch]);


  return { startExtraction, retryFailed, clearHistory, startDownload };
};

// --- 4. UI COMPONENTS ---

const Header: FC = () => (
  <header>
    <h1>{t.title}</h1>
    <p>{t.subtitle}</p>
  </header>
);

const ExtractionPanel: FC = () => {
    const { state, dispatch } = useProgressContext();
    const { startExtraction, retryFailed, clearHistory } = useAppActions();
    const hasFailed = useMemo(() => Object.values(state.progress).some(item => item.status === 'error'), [state.progress]);
    const hasProgress = useMemo(() => Object.keys(state.progress).length > 0, [state.progress]);

    return (
        <div className="card">
            <label htmlFor="url-input">{t.urlListLabel}</label>
            <textarea
                id="url-input"
                value={state.urlsToProcess}
                onChange={e => dispatch({ type: 'SET_URLS', payload: e.target.value })}
                placeholder={t.urlListPlaceholder}
                aria-label={t.urlListLabel}
                disabled={state.isProcessing}
            />
            <div className="actions-panel">
                <button
                    className="btn btn-primary"
                    onClick={startExtraction}
                    disabled={state.isProcessing || !state.urlsToProcess.trim()}
                    aria-label={t.ariaExtract}
                >
                    {t.extract}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={retryFailed}
                    disabled={state.isProcessing || !hasFailed}
                    aria-label={t.ariaRetry}
                >
                    {t.retryFailed}
                </button>
                 <button
                    className="btn btn-secondary"
                    onClick={() => clearHistory('all')}
                    disabled={state.isProcessing || !hasProgress}
                    aria-label={t.ariaClearAll}
                >
                    {t.clearAll}
                </button>
            </div>
        </div>
    );
};

const UrlSelectionList: FC<{ completedItems: [string, ProgressItem][] }> = ({ completedItems }) => {
    const { state, dispatch } = useProgressContext();

    return (
        <>
            <label>{t.selectUrlsForDownload}</label>
            <ul className="url-selection-list">
                {completedItems.map(([url]) => (
                    <li key={url} className="url-selection-item">
                        <input
                            type="checkbox"
                            id={`cb-${url}`}
                            checked={state.selectedUrlsForDownload.has(url)}
                            onChange={() => dispatch({ type: 'TOGGLE_URL_SELECTION', payload: url })}
                            disabled={state.isProcessing}
                        />
                        <label htmlFor={`cb-${url}`}>{url}</label>
                    </li>
                ))}
            </ul>
        </>
    );
};


const DownloadPanel: FC = () => {
    const { state, dispatch } = useProgressContext();
    const { startDownload, clearHistory } = useAppActions();

    const completedItems = useMemo(() => Object.entries(state.progress).filter(([, item]) => item.status === 'completed'), [state.progress]);

    if (completedItems.length === 0) {
        return null;
    }

    return (
        <div className="card">
            <h2 className="card-title">{t.downloadSectionTitle}</h2>
            
            <div>
                <label>{t.downloadTarget}</label>
                <div className="radio-group">
                    <label>
                        <input
                            type="radio"
                            name="downloadTarget"
                            value="selected"
                            checked={state.downloadTarget === 'selected'}
                            onChange={() => dispatch({ type: 'SET_DOWNLOAD_TARGET', payload: 'selected'})}
                            disabled={state.isProcessing}
                        />
                        {t.downloadByUrl}
                    </label>
                    <label>
                        <input
                            type="radio"
                            name="downloadTarget"
                            value="all"
                            checked={state.downloadTarget === 'all'}
                            onChange={() => dispatch({ type: 'SET_DOWNLOAD_TARGET', payload: 'all'})}
                            disabled={state.isProcessing}
                        />
                        {t.downloadAll}
                    </label>
                </div>
            </div>

            {state.downloadTarget === 'selected' && <UrlSelectionList completedItems={completedItems} />}
            
            <hr className="divider"/>

            <div>
              <label>{t.downloadFormatLabel}</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    name="downloadType"
                    value="individual"
                    checked={state.downloadOptions.type === 'individual'}
                    onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { type: 'individual' } })}
                    disabled={state.isProcessing}
                  />
                  {t.individualFiles}
                </label>
                <label>
                  <input
                    type="radio"
                    name="downloadType"
                    value="zip"
                    checked={state.downloadOptions.type === 'zip'}
                    onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { type: 'zip' } })}
                    disabled={state.isProcessing}
                  />
                  {t.zipArchive}
                </label>
                <label>
                  <input
                    type="radio"
                    name="downloadType"
                    value="combined-text"
                    checked={state.downloadOptions.type === 'combined-text'}
                    onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { type: 'combined-text' } })}
                    disabled={state.isProcessing}
                  />
                  {t.combinedText}
                </label>
              </div>
            </div>
            
            <div>
                <label htmlFor="maxSize">{t.maxSizeLabel}</label>
                <input
                    id="maxSize"
                    type="number"
                    min="0"
                    value={state.downloadOptions.maxSize}
                    onChange={e => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { maxSize: parseInt(e.target.value, 10) || 0 } })}
                    disabled={state.isProcessing}
                />
            </div>

            <div className="actions-panel">
                <button
                    className="btn btn-primary"
                    onClick={startDownload}
                    disabled={state.isProcessing || (state.downloadTarget === 'selected' && state.selectedUrlsForDownload.size === 0)}
                    aria-label={t.ariaDownload}
                >
                    {t.download}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => clearHistory('completed')}
                    disabled={state.isProcessing}
                    aria-label={t.ariaClearCompleted}
                >
                    {t.clearCompleted}
                </button>
            </div>
        </div>
    );
};

type FilterType = 'all' | ProgressStatus;
interface FilterTabsProps {
  currentFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  counts: { [key in FilterType]?: number };
}

const FilterTabs: FC<FilterTabsProps> = ({ currentFilter, onFilterChange, counts }) => {
    const filters: FilterType[] = ['all', 'completed', 'pending', 'error'];
    const filterLabels: Record<FilterType, string> = t.filters;

    return (
        <div className="filter-tabs" role="tablist" aria-label="進捗フィルター">
            {filters.map(filter => (
                <button
                    key={filter}
                    className={`filter-tab ${currentFilter === filter ? 'active' : ''}`}
                    onClick={() => onFilterChange(filter)}
                    role="tab"
                    aria-selected={currentFilter === filter}
                >
                    {filterLabels[filter]} ({counts[filter] || 0})
                </button>
            ))}
        </div>
    );
};

interface ProgressListProps {
  items: [string, ProgressItem][];
}

const ProgressList: FC<ProgressListProps> = ({ items }) => {
  if (items.length === 0) {
    return <div className="empty-state">{t.noItemsToDisplay}</div>;
  }
  return (
    <ul className="progress-list">
      {items.map(([url, item]) => (
        <li key={url} className="progress-item">
          <span className="progress-item-url" title={url}>{url}</span>
          <span className={`status-badge status-${item.status}`}>{t.status[item.status]}</span>
        </li>
      ))}
    </ul>
  );
};


const ProgressView: FC = () => {
    const { state } = useProgressContext();
    const [filter, setFilter] = useState<FilterType>('all');
    
    const progressItems = useMemo(() => Object.entries(state.progress), [state.progress]);

    const counts = useMemo(() => {
        const acc: { [key in FilterType]?: number } = { all: progressItems.length };
        progressItems.forEach(([, item]) => {
            acc[item.status] = (acc[item.status] || 0) + 1;
        });
        return acc;
    }, [progressItems]);

    const filteredItems = useMemo(() => {
        if (filter === 'all') return progressItems;
        return progressItems.filter(([, item]) => item.status === filter);
    }, [progressItems, filter]);

    if (progressItems.length === 0) {
        return (
            <div className="card">
                <div className="empty-state">{t.noDownloadHistory}</div>
            </div>
        );
    }
    
    return (
        <div className="card">
            <FilterTabs currentFilter={filter} onFilterChange={setFilter} counts={counts} />
            <ProgressList items={filteredItems} />
        </div>
    );
}

const App: FC = () => {
  return (
    <ProgressProvider>
      <Header />
      <ExtractionPanel />
      <ProgressView />
      <DownloadPanel />
    </ProgressProvider>
  );
};

// --- 5. RENDER ---

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}