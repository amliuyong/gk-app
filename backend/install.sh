
export AWS_REGION=us-west-2

export JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=true

echo -n "Enter stack name: (gkRec) "
read stackName

if [ -z "$stackName" ]; then
  stackName="gkRec"
fi

echo "Deploying backend stack..."
npx cdk deploy --require-approval never --context stackName=$stackName