import { useState } from "react";
import { isFolder } from "@api-lab/workspace-engine";
import { useAppStore } from "../../store/useAppStore";
import { Dialog } from "../common/Dialog";

interface SaveRequestDialogProps {
  tabId: string;
  onClose: () => void;
}

export function SaveRequestDialog({ tabId, onClose }: SaveRequestDialogProps) {
  const collections = useAppStore((s) => s.workspace.collections);
  const saveNewRequest = useAppStore((s) => s.saveNewRequest);
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));

  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState(tab?.name ?? "New Request");

  const selectedCollection = collections.find((c) => c.id === collectionId);
  const folders = selectedCollection ? selectedCollection.items.filter(isFolder) : [];

  function handleSave() {
    if (!collectionId || !name.trim()) return;
    saveNewRequest(tabId, { collectionId, folderId: folderId || undefined }, name.trim());
    onClose();
  }

  if (collections.length === 0) {
    return (
      <Dialog onClose={onClose} titleId="save-dialog-title" className="w-full max-w-sm p-4">
        <h2
          id="save-dialog-title"
          className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100"
        >
          Save Request
        </h2>
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
          Create a collection first before saving a request.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Close
        </button>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={onClose} titleId="save-dialog-title" className="w-full max-w-sm p-4">
      <h2
        id="save-dialog-title"
        className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100"
      >
        Save Request
      </h2>

      <label
        className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        htmlFor="save-name"
      >
        Name
      </label>
      <input
        id="save-name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-3 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      />

      <label
        className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        htmlFor="save-collection"
      >
        Collection
      </label>
      <select
        id="save-collection"
        value={collectionId}
        onChange={(e) => {
          setCollectionId(e.target.value);
          setFolderId("");
        }}
        className="mb-3 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      >
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label
        className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        htmlFor="save-folder"
      >
        Folder (optional)
      </label>
      <select
        id="save-folder"
        value={folderId}
        onChange={(e) => setFolderId(e.target.value)}
        className="mb-4 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      >
        <option value="">— None —</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}

