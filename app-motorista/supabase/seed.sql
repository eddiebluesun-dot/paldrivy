-- supabase/seed.sql

insert into platforms (name, country_code, type) values
  ('Uber', null, 'rideshare'),
  ('99', 'BR', 'rideshare'),
  ('inDrive', null, 'rideshare'),
  ('Lyft', 'US', 'rideshare'),
  ('Bolt', null, 'rideshare'),
  ('Cabify', null, 'rideshare'),
  ('DiDi', null, 'rideshare'),
  ('Grab', null, 'rideshare'),
  ('FreeNow', null, 'rideshare'),
  ('99Táxi', 'BR', 'taxi_app'),
  ('Easy Taxi', 'BR', 'taxi_app'),
  ('inDriver Táxi', null, 'taxi_app'),
  ('Convencional / Rádio Táxi', 'BR', 'taxi_conventional'),
  ('Conventional / Street', 'US', 'taxi_conventional');

insert into expense_categories (name_key, type, is_system) values
  ('expense.rent', 'fixed', true),
  ('expense.financing', 'fixed', true),
  ('expense.insurance', 'fixed', true),
  ('expense.internet', 'fixed', true),
  ('expense.tracker', 'fixed', true),
  ('expense.licensing', 'fixed', true),
  ('expense.taxi_license', 'fixed', true),
  ('expense.fuel', 'variable', true),
  ('expense.car_wash', 'variable', true),
  ('expense.maintenance', 'variable', true),
  ('expense.tires', 'variable', true),
  ('expense.oil_change', 'variable', true),
  ('expense.tolls', 'variable', true),
  ('expense.parking', 'variable', true),
  ('expense.food', 'variable', true),
  ('expense.other', 'variable', true);
