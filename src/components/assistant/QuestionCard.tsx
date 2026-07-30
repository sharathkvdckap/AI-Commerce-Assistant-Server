import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AssistantQuestion } from '@/types/assistant'

interface QuestionCardProps {
  question: AssistantQuestion
  disabled?: boolean
  onSelect: (label: string, value: string) => void
}

export function QuestionCard({
  question,
  disabled = false,
  onSelect,
}: QuestionCardProps) {
  // Question text lives in the chat message above; this card is options only
  // so the question stays visible in history after a filter is selected.
  return (
    <Card className="animate-fade-up ml-11 border-accent/20 bg-accent-soft/40 shadow-none">
      <CardContent className="pt-4">
        <div className="flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="option"
              size="option"
              disabled={disabled}
              onClick={() => onSelect(option.label, option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
