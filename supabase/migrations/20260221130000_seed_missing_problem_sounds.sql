-- Seed missing word-practice banks for problem sounds used by profiles.
-- Idempotent: safe to run multiple times.

with seed_words(sound, word, position, order_index) as (
  values
    ('S', 'Sun', 'initial', 0),
    ('S', 'Soup', 'initial', 1),
    ('S', 'Sock', 'initial', 2),
    ('S', 'Sand', 'initial', 3),
    ('S', 'Soap', 'initial', 4),
    ('S', 'Seal', 'initial', 5),
    ('S', 'Seed', 'initial', 6),
    ('S', 'Sofa', 'initial', 7),
    ('S', 'Star', 'initial', 8),
    ('S', 'Smile', 'initial', 9),
    ('R', 'Rabbit', 'initial', 0),
    ('R', 'Rain', 'initial', 1),
    ('R', 'Rope', 'initial', 2),
    ('R', 'Ring', 'initial', 3),
    ('R', 'Robot', 'initial', 4),
    ('R', 'Rocket', 'initial', 5),
    ('R', 'Rose', 'initial', 6),
    ('R', 'River', 'initial', 7),
    ('R', 'Rainbow', 'initial', 8),
    ('R', 'Rattle', 'initial', 9),
    ('TH', 'Thumb', 'initial', 0),
    ('TH', 'Think', 'initial', 1),
    ('TH', 'Thorn', 'initial', 2),
    ('TH', 'Three', 'initial', 3),
    ('TH', 'Thunder', 'initial', 4),
    ('TH', 'Thief', 'initial', 5),
    ('TH', 'Thread', 'initial', 6),
    ('TH', 'Throw', 'initial', 7),
    ('TH', 'Thank', 'initial', 8),
    ('TH', 'Thirty', 'initial', 9)
),
active_levels as (
  select distinct level_id
  from therapy_activities
  where type = 'word_practice'
    and is_active = true
),
sound_catalog as (
  select distinct sound from seed_words
),
level_order_base as (
  select
    level_id,
    coalesce(max(order_index), -1) as max_order_index
  from therapy_activities
  group by level_id
),
missing_activities as (
  select
    al.level_id,
    sc.sound,
    row_number() over (partition by al.level_id order by sc.sound) as sound_rank
  from active_levels al
  cross join sound_catalog sc
  where not exists (
    select 1
    from therapy_activities ta
    where ta.level_id = al.level_id
      and ta.type = 'word_practice'
      and ta.is_active = true
      and upper(coalesce(ta.target_letter, '')) = sc.sound
  )
),
inserted_activities as (
  insert into therapy_activities (
    level_id,
    type,
    title,
    target_letter,
    difficulty,
    order_index,
    is_active
  )
  select
    ma.level_id,
    'word_practice'::therapy_activity_type,
    format('Word Practice - %s', ma.sound),
    ma.sound,
    'beginner'::therapy_difficulty,
    lob.max_order_index + ma.sound_rank,
    true
  from missing_activities ma
  join level_order_base lob
    on lob.level_id = ma.level_id
  returning id, level_id, target_letter
),
target_activities as (
  select
    ia.id,
    ia.level_id,
    upper(ia.target_letter) as target_letter
  from inserted_activities ia

  union all

  select
    ta.id,
    ta.level_id,
    upper(ta.target_letter) as target_letter
  from therapy_activities ta
  where ta.type = 'word_practice'
    and ta.is_active = true
    and ta.level_id in (select level_id from active_levels)
    and upper(coalesce(ta.target_letter, '')) in (select sound from sound_catalog)
),
rows_to_insert as (
  select
    a.id as activity_id,
    sw.sound,
    sw.word,
    sw.position,
    sw.order_index
  from target_activities a
  join seed_words sw
    on sw.sound = a.target_letter
)
insert into therapy_items (
  activity_id,
  item_type,
  payload_json,
  order_index,
  is_active
)
select
  rti.activity_id,
  'word'::therapy_item_type,
  jsonb_build_object(
    'text', rti.word,
    'letter', rti.sound,
    'examples', jsonb_build_array(rti.word),
    'position', rti.position,
    'targetSound', rti.sound
  ),
  rti.order_index,
  true
from rows_to_insert rti
where not exists (
  select 1
  from therapy_items ti
  where ti.activity_id = rti.activity_id
    and ti.item_type = 'word'
    and upper(coalesce(ti.payload_json->>'text', '')) = upper(rti.word)
);
