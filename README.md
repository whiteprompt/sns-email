# LIGHTNING TALK SES

## Run locally

* clone
* configure your AWS SES ruleset
* create an AWS SNS Topic
* run `npm install`
* run `sls dynamodb install`
* run `cp .env.example .env && cp .env.development`
  * edit `.env` and `.env.development` according to your configuration

## deploy

* run `sls deploy --stage prod`
