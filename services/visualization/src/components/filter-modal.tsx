"use client";

import { SlidersHorizontal } from "lucide-react";
import React, { ReactNode, useState } from "react";

import { Modal } from "@/components/modal";

type FilterModalButtonProps = {
  activeCount?: number;
  title?: string;
  description?: string;
  children: ReactNode;
};

export function FilterModalButton({
  activeCount = 0,
  title = "筛选",
  description,
  children
}: FilterModalButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline">
        <SlidersHorizontal className="h-4 w-4" />
        筛选
        {activeCount > 0 ? (
          <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
            {activeCount}
          </span>
        ) : null}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size="lg">
        {children}
      </Modal>
    </>
  );
}
