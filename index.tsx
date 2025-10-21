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
  fileArrangementLabel: 'ファイルのまとめ方',
  individualContent: '個別ファイル (URLごと)',
  combinedContent: '結合ファイル (すべてを1つに)',
  packageFormatLabel: 'ダウンロード方法',
  downloadAsFiles: '個別ダウンロード (.txt)',
  downloadAsZip: 'ZIPアーカイブ (.zip)',
  maxSizePerFileLabel: '1ファイルあたりの最大サイズ (KB)',
  combinedFilenameLabel: '結合ファイル名',
  combinedFilenamePlaceholder: 'combined_content.txt',
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
  noCompletedItems: 'ダウンロード可能な完了済み項目がありません。',
  helpTitle: '使い方ガイド',
  helpAria: 'ヘルプを開く',
  helpClose: '閉じる',
  helpSection1Title: '1. コンテンツの抽出',
  helpSection1Content: [
    'テキストエリアに、内容を抽出したいウェブページのURLを1行に1つずつ入力します。',
    '「抽出を開始」ボタンをクリックすると、各URLのコンテンツ取得が始まります。',
    '進捗状況は画面下部のリストに表示され、ステータスが「待機中」から「完了」または「エラー」に変わります。'
  ],
  helpSection2Title: '2. ダウンロード',
  helpSection2Content: [
    '抽出が完了した項目は、ダウンロードオプションパネルでダウンロードできます。',
    '<strong>ダウンロード対象:</strong> 「URL単位で選択」で特定のURLだけを選ぶか、「完了したものをすべてダウンロード」ですべてを対象にするかを選択します。',
    '<strong>ファイルのまとめ方:</strong> 「個別ファイル」はURLごとにテキストファイルを、「結合ファイル」はすべての内容を1つのファイルにまとめます。',
    '<strong>ダウンロード方法:</strong> 「個別ダウンロード」はファイルを1つずつ、「ZIPアーカイブ」はZIPファイルにまとめてダウンロードします。',
    '<strong>最大サイズ (KB):</strong> ファイルが大きすぎる場合に、ここで指定したサイズで分割または切り詰めます。(0は無制限)',
    '設定を選んだら、「ダウンロード」ボタンをクリックします。'
  ],
  helpSection3Title: '3. リストの管理',
  helpSection3Content: [
    '<strong>失敗を再試行:</strong> エラーになったURLのみ、コンテンツの再取得を試みます。',
    '<strong>完了をクリア:</strong> 完了した項目をリストから削除します。',
    '<strong>すべてクリア:</strong> すべての履歴（URL入力、進捗状況）をリセットします。'
  ]
};

// --- 1. TYPES ---
declare var JSZip: any;

type ProgressStatus = 'pending' | 'completed' | 'error';
type ContentFormat = 'individual' | 'combined';
type PackageFormat = 'files' | 'zip';
type DownloadTarget = 'selected' | 'all';

interface ProgressItem {
  status: ProgressStatus;
  error?: string;
  content?: string; // To hold fetched file content
}

interface State {
  urlsToProcess: string;
  downloadOptions: {
    contentFormat: ContentFormat;
    packageFormat: PackageFormat;
    maxSize: number;
    combinedFilename: string;
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
  | { type: 'SET_DOWNLOAD_OPTIONS'; payload: { contentFormat?: ContentFormat; packageFormat?: PackageFormat; maxSize?: number; combinedFilename?: string }; }
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
    contentFormat: 'individual',
    packageFormat: 'files',
    maxSize: 1024,
    combinedFilename: 'combined_content.txt',
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
        // FIX: Cast item to ProgressItem to access status property.
        Object.entries(newProgress).forEach(([url, item]) => {
            if (
                (action.payload === 'completed' && (item as ProgressItem).status === 'completed') ||
                (action.payload === 'failed' && (item as ProgressItem).status === 'error')
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
      .filter(([, item]) => (item as ProgressItem).status === 'error')
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
    const { contentFormat, packageFormat, maxSize, combinedFilename } = downloadOptions;
    
    dispatch({ type: 'START_PROCESSING' });

    try {
        let urlsToConsider: string[];
        if (downloadTarget === 'selected') {
            urlsToConsider = Array.from(selectedUrlsForDownload);
        } else {
            // FIX: Cast item to ProgressItem to access status property.
            urlsToConsider = Object.entries(progress)
                .filter(([, item]) => (item as ProgressItem).status === 'completed')
                .map(([url]) => url);
        }

        const completedItems = urlsToConsider
            .map(url => ({ url, item: progress[url] }))
            .filter(({ item }) => item?.status === 'completed' && item.content);
        
        if (completedItems.length === 0) {
            alert("ダウンロード対象のファイルがありません。");
            dispatch({ type: 'FINISH_PROCESSING' });
            return;
        }

        const maxSizeInBytes = maxSize > 0 ? maxSize * 1024 : Infinity;
        const filesToCreate: { filename: string, content: string }[] = [];

        if (contentFormat === 'individual') {
            for (const { url, item } of completedItems) {
                let content = item!.content!;
                const contentBytes = new TextEncoder().encode(content);

                if (contentBytes.length > maxSizeInBytes) {
                    const truncatedBytes = contentBytes.slice(0, maxSizeInBytes);
                    content = new TextDecoder('utf-8', { fatal: false }).decode(truncatedBytes);
                }
                
                const filename = url.replace(/[^a-zA-Z0-9.-]/g, '_') + '.txt';
                filesToCreate.push({ filename, content });
            }
        } else { // combined
            const combinedContent = completedItems
                .map(({ url, item }) => `--- Content from: ${url} ---\n\n${item!.content!}`)
                .join('\n\n\n');

            const combinedContentBytes = new TextEncoder().encode(combinedContent);
            const baseFilename = (combinedFilename.trim() || 'combined_content.txt').replace(/\.txt$/, '');
            
            if (maxSizeInBytes === Infinity || combinedContentBytes.length <= maxSizeInBytes) {
                filesToCreate.push({ filename: `${baseFilename}.txt`, content: combinedContent });
            } else {
                let fileCounter = 1;
                let startIndex = 0;
                while(startIndex < combinedContentBytes.length) {
                    const endIndex = startIndex + maxSizeInBytes;
                    const chunkBytes = combinedContentBytes.slice(startIndex, endIndex);
                    const chunkContent = new TextDecoder('utf-8', { fatal: false }).decode(chunkBytes);
                    
                    const filename = `${baseFilename}_${String(fileCounter).padStart(3, '0')}.txt`;
                    filesToCreate.push({ filename, content: chunkContent });
                    
                    startIndex = endIndex;
                    fileCounter++;
                }
            }
        }

        const downloadFile = (blob: Blob, filename: string) => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        };

        if (packageFormat === 'zip') {
            if (typeof JSZip === 'undefined') {
                alert('ZIPライブラリがロードされていません。');
                dispatch({ type: 'FINISH_PROCESSING' });
                return;
            }
            const zip = new JSZip();
            for (const file of filesToCreate) {
                zip.file(file.filename, file.content);
            }
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadFile(zipBlob, 'downloaded_content.zip');
        } else { // 'files'
            for (const file of filesToCreate) {
                const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
                downloadFile(blob, file.filename);
                await new Promise(resolve => setTimeout(resolve, 100)); // Prevent browser blocking multiple downloads
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

const HelpModal: FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
           if (event.key === 'Escape') {
              onClose();
           }
        };
        window.addEventListener('keydown', handleEsc);
        return () => {
            window.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    if (!isOpen) return null;

    const renderContent = (content: string[]) => (
        <ul>
            {content.map((line, index) => {
                const parts = line.split(/<strong>(.*?)<\/strong>/);
                return (
                    <li key={index}>
                        {parts.map((part, i) =>
                            i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                        )}
                    </li>
                );
            })}
        </ul>
    );

    return (
        <div className={`modal-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 id="help-modal-title">{t.helpTitle}</h2>
                    <button className="modal-close-btn" onClick={onClose} aria-label={t.helpClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <h3>{t.helpSection1Title}</h3>
                    {renderContent(t.helpSection1Content)}
                    <h3>{t.helpSection2Title}</h3>
                    {renderContent(t.helpSection2Content)}
                    <h3>{t.helpSection3Title}</h3>
                    {renderContent(t.helpSection3Content)}
                </div>
            </div>
        </div>
    );
};

const Header: FC<{ onHelpClick: () => void }> = ({ onHelpClick }) => (
  <header>
    <h1>{t.title}</h1>
    <p>{t.subtitle}</p>
    <button className="help-btn" onClick={onHelpClick} aria-label={t.helpAria}>?</button>
  </header>
);

const ExtractionPanel: FC = () => {
    const { state, dispatch } = useProgressContext();
    const { startExtraction, retryFailed, clearHistory } = useAppActions();
    // FIX: Cast item to ProgressItem to access status property.
    const hasFailed = useMemo(() => Object.values(state.progress).some(item => (item as ProgressItem).status === 'error'), [state.progress]);
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

    // FIX: Cast item to ProgressItem to access status property.
    const completedItems = useMemo(() => Object.entries(state.progress).filter(([, item]) => (item as ProgressItem).status === 'completed'), [state.progress]);

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

            <div className="options-grid">
                <div>
                  <label>{t.fileArrangementLabel}</label>
                  <div className="radio-group">
                    <label>
                      <input
                        type="radio"
                        name="contentFormat"
                        value="individual"
                        checked={state.downloadOptions.contentFormat === 'individual'}
                        onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { contentFormat: 'individual' } })}
                        disabled={state.isProcessing}
                      />
                      {t.individualContent}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="contentFormat"
                        value="combined"
                        checked={state.downloadOptions.contentFormat === 'combined'}
                        onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { contentFormat: 'combined' } })}
                        disabled={state.isProcessing}
                      />
                      {t.combinedContent}
                    </label>
                  </div>
                </div>
                
                <div>
                  <label>{t.packageFormatLabel}</label>
                  <div className="radio-group">
                    <label>
                      <input
                        type="radio"
                        name="packageFormat"
                        value="files"
                        checked={state.downloadOptions.packageFormat === 'files'}
                        onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { packageFormat: 'files' } })}
                        disabled={state.isProcessing}
                      />
                      {t.downloadAsFiles}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="packageFormat"
                        value="zip"
                        checked={state.downloadOptions.packageFormat === 'zip'}
                        onChange={() => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { packageFormat: 'zip' } })}
                        disabled={state.isProcessing}
                      />
                      {t.downloadAsZip}
                    </label>
                  </div>
                </div>
                
                <div>
                    <label htmlFor="max-size">{t.maxSizePerFileLabel}</label>
                    <input
                        type="number"
                        id="max-size"
                        value={state.downloadOptions.maxSize}
                        onChange={e => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { maxSize: Number(e.target.value) || 0 } })}
                        min="0"
                        disabled={state.isProcessing || state.downloadOptions.contentFormat !== 'combined'}
                    />
                </div>
                
                <div>
                    <label htmlFor="combined-filename">{t.combinedFilenameLabel}</label>
                    <input
                        type="text"
                        id="combined-filename"
                        value={state.downloadOptions.combinedFilename}
                        onChange={(e) => dispatch({ type: 'SET_DOWNLOAD_OPTIONS', payload: { combinedFilename: e.target.value } })}
                        placeholder={t.combinedFilenamePlaceholder}
                        disabled={state.isProcessing || state.downloadOptions.contentFormat !== 'combined'}
                    />
                </div>
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

const ProgressList: FC = () => {
    const { state } = useProgressContext();
    const [filter, setFilter] = useState<ProgressStatus | 'all'>('all');

    const filteredProgress = useMemo(() => {
        const entries = Object.entries(state.progress);
        if (filter === 'all') return entries;
        // FIX: Cast item to ProgressItem to access status property.
        return entries.filter(([, item]) => (item as ProgressItem).status === filter);
    }, [state.progress, filter]);

    if (Object.keys(state.progress).length === 0) {
        return (
            <div className="card">
                <div className="empty-state">{t.noDownloadHistory}</div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="filter-tabs">
                {(['all', 'completed', 'pending', 'error'] as const).map(f => (
                    <button 
                        key={f} 
                        className={`filter-tab ${filter === f ? 'active' : ''}`}
                        onClick={() => setFilter(f)}
                    >
                        {t.filters[f]}
                    </button>
                ))}
            </div>
            {filteredProgress.length === 0 ? (
                <div className="empty-state">{t.noItemsToDisplay}</div>
            ) : (
                <ul className="progress-list">
                    {filteredProgress.map(([url, item]) => (
                        <li key={url} className="progress-item">
                            <span className="progress-item-url" title={url}>{url}</span>
                            <span className={`status-badge status-${(item as ProgressItem).status}`}>{t.status[(item as ProgressItem).status]}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const App: FC = () => {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <>
      <Header onHelpClick={() => setIsHelpOpen(true)} />
      <main>
        <ExtractionPanel />
        <ProgressList />
        <DownloadPanel />
      </main>
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ProgressProvider>
      <App />
    </ProgressProvider>
  </React.StrictMode>
);