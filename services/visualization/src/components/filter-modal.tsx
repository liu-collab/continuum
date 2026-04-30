"use client";

import { SlidersHorizontal } from "lucide-react";
import React, { ReactNode, useState } from "react";
import { Modal } from "@/components/modal";
import { useAppI18n } from "@/lib/i18n/client";

type FilterModalButtonProps = {
  activeCount?: number;
  title?: string;
  description?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
};

export function FilterModalButton({
  activeCount = 0,
  title,
  description,
  children
}: FilterModalButtonProps) {
  const [open, setOpen] = useState(false);
  const { t } = useAppI18n();
  const titleText = title ?? t("common.filter");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline"
      >
        <SlidersHorizontal style={{ width: 16, height: 16, opacity: 0.6 }} />
        {t("common.filter")}
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
      <Modal open={open} onClose={() => setOpen(false)} title={titleText} description={description} size="lg">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </Modal>
    </>
  );
}
