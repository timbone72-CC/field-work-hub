-- Business conflicts must reach the caller rather than PostgREST 14's
-- unbounded serialization retry runner. Change only the two observed owners.
do $repair$
declare target record; function_id oid; original pg_proc%rowtype;
  repaired pg_proc%rowtype; definition text;
begin
  for target in select * from (values
    ('private.admin_correction_basis(uuid)',
     'e8aa66ab1f48e9f30c053f715ec2c201',4),
    ('private.admin_set_photo_requirements_phase4_engine(uuid,uuid,jsonb)',
     'd91ff5f2b5eeda06129171ae057b715c',1)
  ) as reviewed(signature,source_md5,conflict_count)
  loop
    function_id:=target.signature::regprocedure;
    select * into original from pg_proc where oid=function_id;
    if md5(original.prosrc)<>target.source_md5
      or (length(original.prosrc)-length(replace(original.prosrc,'''40001''','')))/7
         <>target.conflict_count
    then raise exception 'Nonretryable work repair stopped: reviewed source drift';end if;
    definition:=pg_get_functiondef(function_id);
    execute replace(definition,'''40001''','''PT409''');
    select * into repaired from pg_proc where oid=function_id;
    if repaired.prosrc is distinct from replace(original.prosrc,'''40001''','''PT409''')
      or repaired.proacl is distinct from original.proacl
      or repaired.proconfig is distinct from original.proconfig
      or repaired.prosecdef is distinct from original.prosecdef
      or repaired.proowner is distinct from original.proowner
      or repaired.prorettype is distinct from original.prorettype
      or repaired.proargtypes is distinct from original.proargtypes
    then raise exception 'Nonretryable work repair stopped: protected function drift';end if;
  end loop;
end;
$repair$;
