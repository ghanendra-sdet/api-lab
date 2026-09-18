import { useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { Dialog } from "../common/Dialog";

interface CreateWorkspaceDialogProps {
  onClose: () => void;
}

/** A focused "new workspace" dialog: name + optional description, nothing
 * else — matches SaveRequestDialog's simple single-purpose form convention. */
export function CreateWorkspaceDialog({ onClose }: CreateWorkspaceDialogProps) {
  const createWorkspace = useAppStore((s) => s.createWorkspace);
  const [name, setName] = useState("New Workspace");
  const [description, setDescription] = useState("");

  function handleCreate() {
    if (!name.trim()) return;
    createWorkspace(name.trim(), description.trim() || undefined);
    onClose();
  }

  return (
    <Dialog onClose={onClose} titleId="create-workspace-title" className="w-full max-w-sm p-4">
      <h2
        id="create-workspace-title"
        className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100"
      >
        New Workspace
      </h2>

      <label
        className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        htmlFor="workspace-name"
      >
        Name
      </label>
      <input
        id="workspace-name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-3 w-full rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      />

      <label
        className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400"
        htmlFor="workspace-description"
      >
        Description (optional)
      </label>
      <textarea
        id="workspace-description"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="mb-4 w-full resize-none rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
      />

      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        A new workspace starts empty. Collections, folders, and requests belong to whichever
        workspace is active — environments and global variables stay shared across all
        workspaces.
      </p>

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
          onClick={handleCreate}
          disabled={!name.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </Dialog>
  );
}
