create table if not exists __PRIVATE_SCHEMA_IDENT__."memory_relations" (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_record_id uuid not null,
  target_record_id uuid not null,
  relation_type text not null,
  strength numeric(3, 2) not null,
  bidirectional boolean not null default false,
  reason text not null,
  created_by_service text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_relations_strength_check check (strength between 0 and 1),
  constraint memory_relations_unique_idx unique (
    workspace_id,
    source_record_id,
    target_record_id,
    relation_type
  )
);

create index if not exists memory_relations_source_idx
  on __PRIVATE_SCHEMA_IDENT__."memory_relations" (workspace_id, source_record_id, updated_at desc);

create index if not exists memory_relations_target_idx
  on __PRIVATE_SCHEMA_IDENT__."memory_relations" (workspace_id, target_record_id, updated_at desc);
