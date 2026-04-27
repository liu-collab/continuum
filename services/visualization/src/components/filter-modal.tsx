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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline"
      >
        <SlidersHorizontal style={{ width: 16, height: 16, opacity: 0.6 }} />
        筛选
        {activeCount > 0 ? (
          <span style={{
            marginLeft: "0.25rem",
            borderRadius: "999px",
            background: "var(--cyan)",
            color: "var(--bg)",
            padding: "0 0.375rem",
            fontSize: "0.625rem",
            fontWeight: 600
          }}>
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
