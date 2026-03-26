export default function BookLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50" style={{ maxWidth: '672px', margin: '0 auto', padding: '32px 24px', width: '100%' }}>
      {children}
    </div>
  )
}
