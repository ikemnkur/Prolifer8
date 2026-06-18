import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';

type Todo = {
  id: string;
  name: string;
};

export default function SupabaseTodosExample() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    const loadTodos = async () => {
      const { data, error: queryError } = await supabase.from('todos').select('id,name');

      if (!mounted) return;

      if (queryError) {
        setError(queryError.message);
        return;
      }

      setTodos((data || []) as Todo[]);
    };

    loadTodos();

    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <p>Supabase error: {error}</p>;

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  );
}
