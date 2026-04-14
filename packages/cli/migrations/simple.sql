-- Create this in simple.sql
CREATE TABLE api.messages (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL
);
INSERT INTO api.messages (text) VALUES ('Automation works!');
