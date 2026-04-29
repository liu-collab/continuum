create index if not exists memory_read_model_user_preflight_idx
  on __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (user_id, status, memory_type, importance)
  where scope = 'user';

create index if not exists memory_read_model_workspace_preflight_idx
  on __SHARED_SCHEMA_IDENT__.memory_read_model_v1 (workspace_id, status, scope, memory_type, importance)
  where scope in ('workspace', 'task', 'session');
