export default function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-500">
      <h1 className="text-xl font-semibold text-gray-800">MMD — Multi-Model Deliberation</h1>
      <p className="max-w-md text-sm">
        Select a conversation on the left, or start a new one, to ask a question and
        watch several models propose, critique, revise, and vote toward a consensus
        answer.
      </p>
    </div>
  );
}
