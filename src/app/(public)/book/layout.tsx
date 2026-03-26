export default function BookLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6">
      {children}
    </div>
  )
}
