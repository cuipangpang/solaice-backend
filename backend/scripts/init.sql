-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 宠物基础档案
CREATE TABLE IF NOT EXISTS pet_profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         VARCHAR(100) NOT NULL,
  name            VARCHAR(50) NOT NULL,
  species         VARCHAR(20) NOT NULL,
  breed           VARCHAR(100),
  age_years       DECIMAL(4,1),
  gender          VARCHAR(10),
  neutered        BOOLEAN DEFAULT false,
  medical_history TEXT,
  allergies       TEXT,
  avatar_url      TEXT,
  birthday        DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 健康检测记录
CREATE TABLE IF NOT EXISTS health_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id            UUID NOT NULL REFERENCES pet_profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  module            VARCHAR(20) NOT NULL,
  module_label      VARCHAR(20) NOT NULL,
  urgency           VARCHAR(20) NOT NULL,

  primary_diagnosis TEXT NOT NULL,
  action_plan       TEXT NOT NULL,
  confidence_level  VARCHAR(10),

  symptoms          JSONB,
  image_url         TEXT,
  image_key         TEXT,

  embedding         vector(1536)
);

-- 疫苗/驱虫记录
CREATE TABLE IF NOT EXISTS vaccine_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pet_id          UUID NOT NULL REFERENCES pet_profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  type            VARCHAR(50) NOT NULL,
  administered_at DATE NOT NULL,
  next_due_at     DATE,
  notes           TEXT,
  deleted_at      TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_health_records_pet_id    ON health_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_health_records_created_at ON health_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_records_module     ON health_records(module);
CREATE INDEX IF NOT EXISTS idx_vaccine_records_pet_id   ON vaccine_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_records_next_due ON vaccine_records(next_due_at);
