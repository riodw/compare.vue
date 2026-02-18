<script setup lang="ts">
import { Sun, Moon, Grid, LogOut, User } from "lucide-vue-next"

// Mock clerk usage since it's not installed
// import { useClerk, useUser } from "vue-clerk";
// const clerk = useClerk();
// const { isLoaded, isSignedIn, user } = useUser();
const isLoaded = true
const user = null as any // Change to mock object to test authenticated state

const mode = useColorMode()
</script>

<template>
  <header
    class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  >
    <div class="container-fluid flex h-14 items-center px-4">
      <Logo />

      <div class="flex flex-1 items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          @click="mode = mode === 'dark' ? 'light' : 'dark'"
        >
          <Sun v-if="mode === 'dark'" class="h-5 w-5" />
          <Moon v-else class="h-5 w-5" />
          <span class="sr-only">Toggle theme</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon">
              <Grid class="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>APPS</DropdownMenuItem>
            <DropdownMenuItem class="font-bold">DoormatKey🔑</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <template v-if="isLoaded">
          <div v-if="user">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" class="relative h-8 w-8 rounded-full">
                  <Avatar class="h-8 w-8">
                    <AvatarImage :src="user.imageUrl" :alt="user.fullName" />
                    <AvatarFallback>{{ user.fullName?.[0] }}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-56" align="end">
                <DropdownMenuItem disabled class="justify-center">
                  {{ user.fullName }}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <LogOut class="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div v-else>
            <Button variant="outline" class="ml-2">Login</Button>
            <Button class="ml-2">Sign Up</Button>
          </div>
        </template>
      </div>
    </div>
  </header>
</template>
